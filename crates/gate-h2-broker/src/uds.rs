use std::{
    fs,
    io::{self, Read, Write},
    os::fd::AsRawFd,
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use crate::{
    Broker,
    model::{ExchangeRequest, ExchangeResponse},
};

const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024;

pub struct SocketGuard {
    directory: PathBuf,
}
impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

pub fn bind_owner_only(directory: &Path) -> io::Result<(UnixListener, SocketGuard)> {
    fs::create_dir(directory)?;
    fs::set_permissions(
        directory,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )?;
    let socket = directory.join("broker.sock");
    let listener = UnixListener::bind(&socket)?;
    fs::set_permissions(&socket, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    Ok((
        listener,
        SocketGuard {
            directory: directory.to_path_buf(),
        },
    ))
}

pub fn serve(listener: UnixListener, broker: Arc<Mutex<Broker>>) -> io::Result<()> {
    loop {
        let (mut stream, _) = listener.accept()?;
        let expected_uid = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?
            .expected_uid();
        if peer_uid(&stream)? != expected_uid {
            write_rejection(
                &mut stream,
                "00000000000000000000000000000000",
                "protocol_error",
            )?;
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unexpected Unix peer",
            ));
        }
        handle_stream(&mut stream, &broker)?;
        let mut state = broker
            .lock()
            .map_err(|_| io::Error::other("broker state poisoned"))?;
        if state.is_terminal() {
            state
                .seal_transcript()
                .map_err(|_| io::Error::other("transcript seal failed"))?;
            return Ok(());
        }
    }
}

fn handle_stream(stream: &mut UnixStream, broker: &Arc<Mutex<Broker>>) -> io::Result<()> {
    let (path, body) = read_request(stream)?;
    let capability_id = path
        .strip_prefix("/v1/exchange/")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid exchange path"))?;
    let request: ExchangeRequest = serde_json::from_value(parse_no_duplicates(&body)?)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid protocol body"))?;
    let response = broker
        .lock()
        .map_err(|_| io::Error::other("broker state poisoned"))?
        .exchange(capability_id, request)
        .map_err(|_| io::Error::other("exchange state failure"))?;
    write_response(stream, &response)
}

fn parse_no_duplicates(bytes: &[u8]) -> io::Result<serde_json::Value> {
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
            Ok(v.into())
        }
        fn visit_u64<E: Error>(self, v: u64) -> Result<Self::Value, E> {
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

fn read_request(stream: &mut UnixStream) -> io::Result<(String, Vec<u8>)> {
    let mut bytes = Vec::new();
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
        } else if !header.name.eq_ignore_ascii_case("host")
            && !header.name.eq_ignore_ascii_case("content-type")
            && !header.name.eq_ignore_ascii_case("connection")
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected request header",
            ));
        }
    }
    let length = length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing content length"))?;
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
    Ok((path, bytes[header_end..].to_vec()))
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
        fn parse(raw: &[u8]) -> io::Result<(String, Vec<u8>)> {
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
        assert!(parse_no_duplicates(br#"{"x":1,"x":2}"#).is_err());
    }
}
