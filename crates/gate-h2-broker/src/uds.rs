use std::{
    fs,
    io::{self, Read, Write},
    os::fd::AsRawFd,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use crate::{
    Broker,
    model::{ExchangeRequest, ExchangeResponse},
};
use zeroize::Zeroizing;

const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024;
const ACCEPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub struct SocketGuard {
    directory: PathBuf,
}
impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

pub fn bind_owner_only(directory: &Path) -> io::Result<(UnixListener, SocketGuard)> {
    let parent = directory.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "socket directory has no parent",
        )
    })?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    let name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid socket directory"))?;
    if !parent_metadata.file_type().is_dir()
        || parent_metadata.file_type().is_symlink()
        || parent_metadata.uid() != unsafe { libc::geteuid() }
        || parent_metadata.permissions().mode() & 0o022 != 0
        || name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe socket parent or directory name",
        ));
    }
    fs::create_dir(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let socket = directory.join("broker.sock");
    let listener = UnixListener::bind(&socket)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
    let socket_metadata = fs::symlink_metadata(&socket)?;
    if !socket_metadata.file_type().is_socket()
        || socket_metadata.uid() != unsafe { libc::geteuid() }
        || socket_metadata.permissions().mode() & 0o777 != 0o600
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe broker socket",
        ));
    }
    Ok((
        listener,
        SocketGuard {
            directory: directory.to_path_buf(),
        },
    ))
}

pub fn serve(listener: UnixListener, broker: Arc<Mutex<Broker>>) -> io::Result<()> {
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_stream,
        configure_stream,
        peer_uid,
        seal_broker,
    )
}

fn serve_with_hooks(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
    accept_timeout: std::time::Duration,
    accept: fn(&UnixListener) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)>,
    configure: fn(&UnixStream) -> io::Result<()>,
    identify_peer: fn(&UnixStream) -> io::Result<u32>,
    seal: fn(&mut Broker) -> io::Result<()>,
) -> io::Result<()> {
    loop {
        if let Err(error) = wait_readable(listener.as_raw_fd(), accept_timeout) {
            terminate_and_seal(&broker, "deadline_exceeded")?;
            return Err(error);
        }
        let (mut stream, _) = match accept(&listener) {
            Ok(value) => value,
            Err(error) => {
                terminate_and_seal(&broker, "protocol_error")?;
                return Err(error);
            }
        };
        if let Err(error) = configure(&stream) {
            terminate_and_seal(&broker, "protocol_error")?;
            return Err(error);
        }
        let expected_uid = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?
            .expected_uid();
        let (peer_matches, code) = match identify_peer(&stream) {
            Ok(uid) => (uid == expected_uid, "wrong_peer"),
            Err(_) => (false, "protocol_error"),
        };
        if !peer_matches {
            terminate_and_seal(&broker, code)?;
            let _ = write_rejection(
                &mut stream,
                "00000000000000000000000000000000",
                "protocol_error",
            );
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, code));
        }
        let response = match handle_stream(&mut stream, &broker) {
            Ok(response) => response,
            Err(_) => {
                terminate_and_seal(&broker, "protocol_error")?;
                let _ = write_rejection(
                    &mut stream,
                    "00000000000000000000000000000000",
                    "protocol_error",
                );
                return Err(io::Error::new(io::ErrorKind::InvalidData, "protocol_error"));
            }
        };
        let terminal = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?
            .is_terminal();
        if terminal {
            let mut state = broker
                .lock()
                .map_err(|_| io::Error::other("broker state poisoned"))?;
            seal(&mut state)?;
            drop(state);
            write_response(&mut stream, &response)?;
            return if response.outcome == "accepted" {
                Ok(())
            } else {
                Err(io::Error::other("exchange failed closed"))
            };
        }
        write_response(&mut stream, &response)?;
    }
}

fn configure_stream(stream: &UnixStream) -> io::Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))
}

fn accept_stream(
    listener: &UnixListener,
) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
    listener.accept()
}

fn seal_broker(broker: &mut Broker) -> io::Result<()> {
    broker
        .seal_transcript()
        .map(|_| ())
        .map_err(|_| io::Error::other("transcript seal failed"))
}

#[cfg(test)]
pub(crate) fn serve_with_timeout_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
    timeout: std::time::Duration,
) -> io::Result<()> {
    serve_with_hooks(
        listener,
        broker,
        timeout,
        accept_stream,
        configure_stream,
        peer_uid,
        seal_broker,
    )
}

#[cfg(test)]
pub(crate) fn serve_with_wrong_peer_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn wrong_peer(_: &UnixStream) -> io::Result<u32> {
        Ok(unsafe { libc::geteuid() }.wrapping_add(1))
    }
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_stream,
        configure_stream,
        wrong_peer,
        seal_broker,
    )
}

#[cfg(test)]
pub(crate) fn serve_with_peer_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn peer_error(_: &UnixStream) -> io::Result<u32> {
        Err(io::Error::other("injected peer credential failure"))
    }
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_stream,
        configure_stream,
        peer_error,
        seal_broker,
    )
}

#[cfg(test)]
pub(crate) fn serve_with_configure_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn configure_error(_: &UnixStream) -> io::Result<()> {
        Err(io::Error::other("injected timeout setup failure"))
    }
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_stream,
        configure_error,
        peer_uid,
        seal_broker,
    )
}

#[cfg(test)]
pub(crate) fn serve_with_seal_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn seal_error(_: &mut Broker) -> io::Result<()> {
        Err(io::Error::other("injected seal failure"))
    }
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_stream,
        configure_stream,
        peer_uid,
        seal_error,
    )
}

#[cfg(test)]
pub(crate) fn serve_with_accept_error_for_test(
    listener: UnixListener,
    broker: Arc<Mutex<Broker>>,
) -> io::Result<()> {
    fn accept_error(_: &UnixListener) -> io::Result<(UnixStream, std::os::unix::net::SocketAddr)> {
        Err(io::Error::other("injected accept failure"))
    }
    serve_with_hooks(
        listener,
        broker,
        ACCEPT_TIMEOUT,
        accept_error,
        configure_stream,
        peer_uid,
        seal_broker,
    )
}

/*
 * Before accept there is no peer stream to answer. The only admissible action is
 * to consume the next capability, durably seal a failed transcript, and return
 * an error/close to the launcher. Once a stream exists, rejection bytes are
 * released only after that same terminal evidence is durable.
 */

fn terminate_and_seal(broker: &Arc<Mutex<Broker>>, code: &'static str) -> io::Result<()> {
    let mut state = broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?;
    state
        .terminate_protocol_failure(code)
        .map_err(|_| io::Error::other("terminal evidence failed"))?;
    state
        .seal_transcript()
        .map_err(|_| io::Error::other("transcript seal failed"))?;
    Ok(())
}

fn handle_stream(
    stream: &mut UnixStream,
    broker: &Arc<Mutex<Broker>>,
) -> io::Result<ExchangeResponse> {
    let (path, body) = read_request(stream)?;
    let capability_id = path
        .strip_prefix("/v1/exchange/")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid exchange path"))?;
    let request: ExchangeRequest = serde_json::from_value(parse_strict_json(&body)?)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid protocol body"))?;
    broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?
        .exchange(capability_id, request)
        .map_err(|_| io::Error::other("exchange state failure"))
}

pub(crate) fn parse_strict_json(bytes: &[u8]) -> io::Result<serde_json::Value> {
    use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
    struct Seed;
    impl<'de> DeserializeSeed<'de> for Seed {
        type Value = serde_json::Value;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
            d.deserialize_any(ValueVisitor)
        }
    }
    struct ValueVisitor;
    impl<'de> Visitor<'de> for ValueVisitor {
        type Value = serde_json::Value;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("strict JSON")
        }
        fn visit_bool<E: Error>(self, v: bool) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_i64<E: Error>(self, v: i64) -> Result<Self::Value, E> {
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&v) {
                return Err(E::custom("JSON integer outside safe range"));
            }
            Ok(v.into())
        }
        fn visit_u64<E: Error>(self, v: u64) -> Result<Self::Value, E> {
            if v > 9_007_199_254_740_991 {
                return Err(E::custom("JSON integer outside safe range"));
            }
            Ok(v.into())
        }
        fn visit_str<E: Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_string<E: Error>(self, v: String) -> Result<Self::Value, E> {
            Ok(v.into())
        }
        fn visit_none<E: Error>(self) -> Result<Self::Value, E> {
            Ok(serde_json::Value::Null)
        }
        fn visit_unit<E: Error>(self) -> Result<Self::Value, E> {
            Ok(serde_json::Value::Null)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some(v) = a.next_element_seed(Seed)? {
                out.push(v)
            }
            Ok(out.into())
        }
        fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
            let mut out = serde_json::Map::new();
            while let Some(k) = a.next_key::<String>()? {
                if out.contains_key(&k) {
                    return Err(A::Error::custom("duplicate JSON key"));
                }
                let v = a.next_value_seed(Seed)?;
                out.insert(k, v);
            }
            Ok(out.into())
        }
        fn visit_f64<E: Error>(self, _: f64) -> Result<Self::Value, E> {
            Err(E::custom("floating-point JSON forbidden"))
        }
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    let value = Seed
        .deserialize(&mut de)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid strict JSON"))?;
    de.end()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "trailing JSON"))?;
    Ok(value)
}

fn read_request(stream: &mut UnixStream) -> io::Result<(String, Zeroizing<Vec<u8>>)> {
    let mut bytes = Zeroizing::new(Vec::new());
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated request",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request headers too large",
            ));
        }
        if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let mut headers = [httparse::EMPTY_HEADER; 16];
    let mut request = httparse::Request::new(&mut headers);
    request
        .parse(&bytes[..header_end])
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "malformed HTTP request"))?;
    if request.method != Some("POST") || request.version != Some(1) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "only HTTP/1.1 POST is permitted",
        ));
    }
    let path = request.path.unwrap().to_owned();
    let mut length = None;
    let mut host = None;
    let mut content_type = None;
    let mut connection = None;
    for header in request.headers.iter() {
        if header.name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate content length",
                ));
            }
            length = Some(
                std::str::from_utf8(header.value)
                    .ok()
                    .and_then(|v| v.parse::<usize>().ok())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::InvalidData, "invalid content length")
                    })?,
            );
        } else if header.name.eq_ignore_ascii_case("host") {
            if host.replace(header.value).is_some() {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "duplicate host"));
            }
        } else if header.name.eq_ignore_ascii_case("content-type") {
            if content_type.replace(header.value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate content type",
                ));
            }
        } else if header.name.eq_ignore_ascii_case("connection") {
            if connection.replace(header.value).is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "duplicate connection",
                ));
            }
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected request header",
            ));
        }
    }
    let length = length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing content length"))?;
    if host != Some(b"gate-h2".as_slice())
        || content_type != Some(b"application/json".as_slice())
        || connection != Some(b"close".as_slice())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid required protocol headers",
        ));
    }
    if length > MAX_BODY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "protocol body too large",
        ));
    }
    while bytes.len() < header_end + length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated body",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    if bytes.len() != header_end + length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request smuggling bytes",
        ));
    }
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    let mut trailing = [0_u8; 1];
    if stream.read(&mut trailing)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request smuggling bytes",
        ));
    }
    Ok((path, Zeroizing::new(bytes[header_end..].to_vec())))
}

fn wait_readable(fd: i32, timeout: std::time::Duration) -> io::Result<()> {
    let mut poll_fd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let timeout_ms = i32::try_from(timeout.as_millis()).unwrap_or(i32::MAX);
    let result = unsafe { libc::poll(&mut poll_fd, 1, timeout_ms) };
    if result > 0 && poll_fd.revents & libc::POLLIN != 0 {
        Ok(())
    } else if result == 0 {
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "broker accept deadline",
        ))
    } else if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Err(io::Error::other("broker listener failed"))
    }
}

fn write_response(stream: &mut UnixStream, response: &ExchangeResponse) -> io::Result<()> {
    let body = serde_json::to_vec(response)?;
    write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.flush()
}

fn write_rejection(
    stream: &mut UnixStream,
    request_id: &str,
    code: &'static str,
) -> io::Result<()> {
    write_response(
        stream,
        &ExchangeResponse {
            schema_version: crate::PROTOCOL_VERSION.into(),
            message_type: "exchange_response".into(),
            request_id: request_id.into(),
            outcome: "rejected".into(),
            exchange_consumed: true,
            output_artifact: None,
            failure_code: Some(code.into()),
        },
    )
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    if rc == 0 {
        Ok(cred.uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut uid = 0;
    let mut gid = 0;
    let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if rc == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn owner_only_socket_is_removed_with_guard() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let (listener, guard) = bind_owner_only(&directory).unwrap();
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(directory.join("broker.sock"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        drop(listener);
        drop(guard);
        assert!(!directory.exists());
    }

    #[test]
    fn malformed_method_and_duplicate_length_are_rejected() {
        fn parse(raw: &[u8]) -> io::Result<(String, Zeroizing<Vec<u8>>)> {
            let (mut writer, mut reader) = UnixStream::pair()?;
            writer.write_all(raw)?;
            writer.shutdown(std::net::Shutdown::Write)?;
            read_request(&mut reader)
        }
        assert!(parse(b"CONNECT x HTTP/1.1\r\ncontent-length: 0\r\n\r\n").is_err());
        assert!(
            parse(
                b"POST /v1/exchange/x HTTP/1.1\r\ncontent-length: 0\r\ncontent-length: 0\r\n\r\n"
            )
            .is_err()
        );
        assert!(parse(b"POST /v1/exchange/x HTTP/1.1\r\ntransfer-encoding: chunked\r\ncontent-length: 0\r\n\r\n").is_err());
        assert!(parse_strict_json(br#"{"x":1,"x":2}"#).is_err());
        assert!(parse_strict_json(br#"{"x":9007199254740992}"#).is_err());
        assert!(parse_strict_json(br#"{"x":-9007199254740992}"#).is_err());
        assert!(parse_strict_json(br#"{"x":9007199254740991}"#).is_ok());
    }
}
