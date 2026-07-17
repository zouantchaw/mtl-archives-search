use std::{
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs},
    sync::Arc,
    time::{Duration, Instant},
};

use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use rustls_pki_types::{CertificateDer, ServerName};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    credential::SecretBytes,
    model::FilePin,
    policy::{is_forbidden, validate_dns_answers, verify_connected_peer},
};

const MAX_UPSTREAM_HEADER_BYTES: usize = 16 * 1024;

pub(crate) enum AuthHeader<'a> {
    Bearer(&'a SecretBytes),
    ApiKey(&'a SecretBytes),
}

pub(crate) struct NetworkRequest<'a> {
    pub hostname: &'a str,
    pub port: u16,
    pub method: &'a str,
    pub path_query: &'a str,
    pub auth: Option<AuthHeader<'a>>,
    pub body: &'a [u8],
    pub connect_deadline: Duration,
    pub exchange_deadline: Duration,
    pub response_byte_cap: u64,
}

#[derive(Clone, Debug)]
pub(crate) enum NetworkMilestone {
    DnsResolved {
        dns_answers: Vec<IpAddr>,
        connection_target: IpAddr,
    },
    TlsVerified {
        tls_peer_chain_sha256: String,
    },
    RequestSent,
}

#[derive(Clone, Debug)]
pub(crate) struct NetworkResponse {
    pub status: u16,
    pub media_type: String,
    pub content_encoding: Option<String>,
    pub content_length: Option<u64>,
    pub transfer_encoding: Option<String>,
    pub location: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Error)]
pub enum NetworkFailure {
    #[error("DNS policy failure")]
    DnsForbidden,
    #[error("connected peer mismatch")]
    DnsRebinding,
    #[error("TLS verification failure")]
    Tls,
    #[error("deadline exceeded")]
    Deadline,
    #[error("response framing failure")]
    Framing,
    #[error("response exceeded byte cap")]
    Overflow,
    #[error("durable milestone evidence failure")]
    Evidence,
}

pub(crate) trait NetworkClient: Send + Sync {
    fn exchange(
        &self,
        request: NetworkRequest<'_>,
        milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
    ) -> Result<NetworkResponse, NetworkFailure>;
}

trait Resolver: Send + Sync {
    fn resolve_once(
        &self,
        hostname: &str,
        port: u16,
        deadline: Duration,
    ) -> Result<Vec<IpAddr>, NetworkFailure>;
}

struct SystemResolver;
impl Resolver for SystemResolver {
    fn resolve_once(
        &self,
        hostname: &str,
        port: u16,
        deadline: Duration,
    ) -> Result<Vec<IpAddr>, NetworkFailure> {
        let hostname = hostname.to_owned();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("gate-h2-resolve-once".into())
            .spawn(move || {
                let result = (hostname.as_str(), port)
                    .to_socket_addrs()
                    .map(|answers| answers.map(|answer| answer.ip()).collect::<Vec<_>>());
                let _ = sender.send(result);
            })
            .map_err(|_| NetworkFailure::DnsForbidden)?;
        receiver
            .recv_timeout(deadline)
            .map_err(|error| match error {
                std::sync::mpsc::RecvTimeoutError::Timeout => NetworkFailure::Deadline,
                std::sync::mpsc::RecvTimeoutError::Disconnected => NetworkFailure::DnsForbidden,
            })?
            .map_err(|_| NetworkFailure::DnsForbidden)
    }
}

pub struct ProductionNetworkClient {
    resolver: Arc<dyn Resolver>,
    tls_config: Arc<ClientConfig>,
    allow_loopback_fixture: bool,
    trust_root_pin: FilePin,
}

const TRUST_ROOT_VERSION: &str = "rustls-native-certs-0.8.2:length-prefixed-der-v1";

impl ProductionNetworkClient {
    pub fn new(expected_trust_root_pin: &FilePin) -> Result<Self, NetworkFailure> {
        let native = rustls_native_certs::load_native_certs();
        if !native.errors.is_empty() || native.certs.is_empty() {
            return Err(NetworkFailure::Tls);
        }
        Self::from_roots(
            native.certs,
            expected_trust_root_pin,
            Arc::new(SystemResolver),
            false,
        )
    }

    fn from_roots(
        mut roots: Vec<CertificateDer<'static>>,
        expected_trust_root_pin: &FilePin,
        resolver: Arc<dyn Resolver>,
        allow_loopback_fixture: bool,
    ) -> Result<Self, NetworkFailure> {
        roots.sort_by(|left, right| left.as_ref().cmp(right.as_ref()));
        let actual_pin = trust_root_file_pin(&roots);
        if actual_pin.sha256 != expected_trust_root_pin.sha256
            || actual_pin.bytes != expected_trust_root_pin.bytes
            || actual_pin.version != expected_trust_root_pin.version
        {
            return Err(NetworkFailure::Tls);
        }
        let mut store = RootCertStore::empty();
        let (accepted, rejected) = store.add_parsable_certificates(roots);
        if accepted == 0 || rejected != 0 {
            return Err(NetworkFailure::Tls);
        }
        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let mut tls_config = ClientConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .map_err(|_| NetworkFailure::Tls)?
            .with_root_certificates(store)
            .with_no_client_auth();
        tls_config.alpn_protocols = vec![b"http/1.1".to_vec()];
        tls_config.enable_early_data = false;
        Ok(Self {
            resolver,
            tls_config: Arc::new(tls_config),
            allow_loopback_fixture,
            trust_root_pin: actual_pin,
        })
    }

    pub fn trust_root_pin(&self) -> &FilePin {
        &self.trust_root_pin
    }
}

impl NetworkClient for ProductionNetworkClient {
    fn exchange(
        &self,
        request: NetworkRequest<'_>,
        milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
    ) -> Result<NetworkResponse, NetworkFailure> {
        let exchange_started = Instant::now();
        let answers = self.resolver.resolve_once(
            request.hostname,
            request.port,
            remaining(exchange_started, request.exchange_deadline)?,
        )?;
        let answers = if self.allow_loopback_fixture {
            normalize_fixture_answers(answers)?
        } else {
            validate_dns_answers(&answers).map_err(|_| NetworkFailure::DnsForbidden)?
        };
        let pinned_ip = *answers.first().ok_or(NetworkFailure::DnsForbidden)?;
        milestone(NetworkMilestone::DnsResolved {
            dns_answers: answers.clone(),
            connection_target: pinned_ip,
        })?;
        let connect_budget = request
            .connect_deadline
            .min(remaining(exchange_started, request.exchange_deadline)?);
        let tcp =
            TcpStream::connect_timeout(&SocketAddr::new(pinned_ip, request.port), connect_budget)
                .map_err(map_io)?;
        let peer = tcp
            .peer_addr()
            .map_err(|_| NetworkFailure::DnsRebinding)?
            .ip();
        if self.allow_loopback_fixture {
            if peer != pinned_ip {
                return Err(NetworkFailure::DnsRebinding);
            }
        } else {
            verify_connected_peer(&answers, peer).map_err(|_| NetworkFailure::DnsRebinding)?;
        }

        set_deadlines(&tcp, exchange_started, request.exchange_deadline)?;
        let server_name =
            ServerName::try_from(request.hostname.to_owned()).map_err(|_| NetworkFailure::Tls)?;
        let connection = ClientConnection::new(Arc::clone(&self.tls_config), server_name)
            .map_err(|_| NetworkFailure::Tls)?;
        let mut stream = StreamOwned::new(connection, tcp);
        while stream.conn.is_handshaking() {
            set_deadlines(&stream.sock, exchange_started, request.exchange_deadline)?;
            stream
                .conn
                .complete_io(&mut stream.sock)
                .map_err(map_tls_io)?;
        }
        if stream.conn.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3)
            || stream.conn.alpn_protocol() != Some(b"http/1.1".as_slice())
        {
            return Err(NetworkFailure::Tls);
        }
        let certificates = stream
            .conn
            .peer_certificates()
            .filter(|certificates| !certificates.is_empty())
            .ok_or(NetworkFailure::Tls)?;
        let chain_sha256 = certificate_chain_pin(certificates);
        milestone(NetworkMilestone::TlsVerified {
            tls_peer_chain_sha256: chain_sha256,
        })?;

        write_request(&mut stream, &request, exchange_started)?;
        milestone(NetworkMilestone::RequestSent)?;
        let response = read_response(
            &mut stream,
            request.response_byte_cap,
            exchange_started,
            request.exchange_deadline,
        )?;
        Ok(response)
    }
}

fn write_request(
    stream: &mut StreamOwned<ClientConnection, TcpStream>,
    request: &NetworkRequest<'_>,
    started: Instant,
) -> Result<(), NetworkFailure> {
    let prefix = format!(
        "{} {} HTTP/1.1\r\naccept: application/json\r\ncontent-type: application/json\r\n",
        request.method, request.path_query
    );
    write_piece(
        stream,
        prefix.as_bytes(),
        started,
        request.exchange_deadline,
    )?;
    if let Some(auth) = &request.auth {
        match auth {
            AuthHeader::Bearer(secret) => {
                write_piece(
                    stream,
                    b"authorization: Bearer ",
                    started,
                    request.exchange_deadline,
                )?;
                write_piece(stream, secret.expose(), started, request.exchange_deadline)?;
            }
            AuthHeader::ApiKey(secret) => {
                write_piece(stream, b"x-api-key: ", started, request.exchange_deadline)?;
                write_piece(stream, secret.expose(), started, request.exchange_deadline)?;
            }
        }
        write_piece(stream, b"\r\n", started, request.exchange_deadline)?;
    }
    let suffix = format!(
        "host: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        request.hostname,
        request.body.len()
    );
    write_piece(
        stream,
        suffix.as_bytes(),
        started,
        request.exchange_deadline,
    )?;
    write_piece(stream, request.body, started, request.exchange_deadline)?;
    stream.flush().map_err(map_tls_io)
}

fn write_piece(
    stream: &mut StreamOwned<ClientConnection, TcpStream>,
    bytes: &[u8],
    started: Instant,
    deadline: Duration,
) -> Result<(), NetworkFailure> {
    set_deadlines(&stream.sock, started, deadline)?;
    stream.write_all(bytes).map_err(map_tls_io)
}

fn read_response(
    stream: &mut StreamOwned<ClientConnection, TcpStream>,
    cap: u64,
    started: Instant,
    deadline: Duration,
) -> Result<NetworkResponse, NetworkFailure> {
    let cap = usize::try_from(cap).map_err(|_| NetworkFailure::Overflow)?;
    let mut bytes = Vec::with_capacity((cap + MAX_UPSTREAM_HEADER_BYTES).min(64 * 1024));
    let mut chunk = [0_u8; 8192];
    let header_end = loop {
        set_deadlines(&stream.sock, started, deadline)?;
        let read = stream.read(&mut chunk).map_err(map_tls_io)?;
        if read == 0 {
            return Err(NetworkFailure::Framing);
        }
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
        if bytes.len() > MAX_UPSTREAM_HEADER_BYTES {
            return Err(NetworkFailure::Framing);
        }
    };
    if header_end > MAX_UPSTREAM_HEADER_BYTES {
        return Err(NetworkFailure::Framing);
    }
    let parsed = parse_response_headers(&bytes[..header_end])?;
    let body_length = parsed.content_length.ok_or(NetworkFailure::Framing)?;
    let body_length = usize::try_from(body_length).map_err(|_| NetworkFailure::Overflow)?;
    if body_length > cap {
        return Err(NetworkFailure::Overflow);
    }
    if bytes.len() > header_end + body_length {
        return Err(NetworkFailure::Framing);
    }
    while bytes.len() < header_end + body_length {
        set_deadlines(&stream.sock, started, deadline)?;
        let read = stream.read(&mut chunk).map_err(map_tls_io)?;
        if read == 0 {
            return Err(NetworkFailure::Framing);
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > header_end + body_length {
            return Err(NetworkFailure::Framing);
        }
    }
    set_deadlines(&stream.sock, started, deadline)?;
    match stream.read(&mut chunk[..1]) {
        Ok(0) => {}
        Ok(_) => return Err(NetworkFailure::Framing),
        Err(error) => return Err(map_tls_io(error)),
    }
    Ok(NetworkResponse {
        status: parsed.status,
        media_type: parsed.media_type,
        content_encoding: parsed.content_encoding,
        content_length: parsed.content_length,
        transfer_encoding: parsed.transfer_encoding,
        location: parsed.location,
        body: bytes[header_end..].to_vec(),
    })
}

struct ParsedHeaders {
    status: u16,
    media_type: String,
    content_encoding: Option<String>,
    content_length: Option<u64>,
    transfer_encoding: Option<String>,
    location: Option<String>,
}

fn parse_response_headers(bytes: &[u8]) -> Result<ParsedHeaders, NetworkFailure> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut response = httparse::Response::new(&mut headers);
    if response.parse(bytes).map_err(|_| NetworkFailure::Framing)?
        != httparse::Status::Complete(bytes.len())
        || response.version != Some(1)
    {
        return Err(NetworkFailure::Framing);
    }
    let status = response.code.ok_or(NetworkFailure::Framing)?;
    let mut content_length = None;
    let mut media_type = None;
    let mut content_encoding = None;
    let mut transfer_encoding = None;
    let mut location = None;
    for header in response.headers {
        let value = std::str::from_utf8(header.value).map_err(|_| NetworkFailure::Framing)?;
        if value
            .bytes()
            .any(|byte| byte.is_ascii_control() && byte != b'\t')
        {
            return Err(NetworkFailure::Framing);
        }
        let slot = if header.name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some()
                || value.is_empty()
                || !value.bytes().all(|b| b.is_ascii_digit())
            {
                return Err(NetworkFailure::Framing);
            }
            content_length = Some(value.parse().map_err(|_| NetworkFailure::Framing)?);
            continue;
        } else if header.name.eq_ignore_ascii_case("content-type") {
            &mut media_type
        } else if header.name.eq_ignore_ascii_case("content-encoding") {
            &mut content_encoding
        } else if header.name.eq_ignore_ascii_case("transfer-encoding") {
            &mut transfer_encoding
        } else if header.name.eq_ignore_ascii_case("location") {
            &mut location
        } else {
            continue;
        };
        if slot.replace(value.to_owned()).is_some() {
            return Err(NetworkFailure::Framing);
        }
    }
    Ok(ParsedHeaders {
        status,
        media_type: media_type.ok_or(NetworkFailure::Framing)?,
        content_encoding,
        content_length,
        transfer_encoding,
        location,
    })
}

fn trust_root_file_pin(roots: &[CertificateDer<'_>]) -> FilePin {
    let mut hash = Sha256::new();
    hash.update(b"gate-h2-native-trust-roots-v1\0");
    let mut bytes = 0_u64;
    for root in roots {
        hash.update((root.as_ref().len() as u64).to_be_bytes());
        hash.update(root.as_ref());
        bytes += 8 + root.as_ref().len() as u64;
    }
    FilePin {
        sha256: hex::encode(hash.finalize()),
        bytes,
        version: TRUST_ROOT_VERSION.into(),
    }
}

fn certificate_chain_pin(chain: &[CertificateDer<'_>]) -> String {
    let mut hash = Sha256::new();
    for certificate in chain {
        hash.update((certificate.as_ref().len() as u64).to_be_bytes());
        hash.update(certificate.as_ref());
    }
    hex::encode(hash.finalize())
}

fn remaining(started: Instant, deadline: Duration) -> Result<Duration, NetworkFailure> {
    deadline
        .checked_sub(started.elapsed())
        .filter(|remaining| !remaining.is_zero())
        .ok_or(NetworkFailure::Deadline)
}

fn set_deadlines(
    stream: &TcpStream,
    started: Instant,
    deadline: Duration,
) -> Result<(), NetworkFailure> {
    let remaining = remaining(started, deadline)?;
    stream.set_read_timeout(Some(remaining)).map_err(map_io)?;
    stream.set_write_timeout(Some(remaining)).map_err(map_io)
}

fn map_io(error: std::io::Error) -> NetworkFailure {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        NetworkFailure::Deadline
    } else {
        NetworkFailure::Framing
    }
}

fn map_tls_io(error: std::io::Error) -> NetworkFailure {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        NetworkFailure::Deadline
    } else if error
        .to_string()
        .to_ascii_lowercase()
        .contains("certificate")
    {
        NetworkFailure::Tls
    } else {
        NetworkFailure::Framing
    }
}

fn normalize_fixture_answers(mut answers: Vec<IpAddr>) -> Result<Vec<IpAddr>, NetworkFailure> {
    if answers.is_empty()
        || answers
            .iter()
            .any(|ip| !ip.is_loopback() && is_forbidden(*ip))
    {
        return Err(NetworkFailure::DnsForbidden);
    }
    answers.sort();
    answers.dedup();
    Ok(answers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustls::{ServerConfig, ServerConnection};
    use rustls_pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
    use std::{net::TcpListener, thread};

    struct FixtureResolver(Vec<IpAddr>);
    impl Resolver for FixtureResolver {
        fn resolve_once(
            &self,
            _: &str,
            _: u16,
            _: Duration,
        ) -> Result<Vec<IpAddr>, NetworkFailure> {
            Ok(self.0.clone())
        }
    }

    fn fixture_exchange(
        response: Vec<u8>,
        delay: Duration,
        response_cap: u64,
        deadline: Duration,
    ) -> Result<NetworkResponse, NetworkFailure> {
        fixture_exchange_observed(response, delay, response_cap, deadline).0
    }

    fn fixture_exchange_observed(
        response: Vec<u8>,
        delay: Duration,
        response_cap: u64,
        deadline: Duration,
    ) -> (
        Result<NetworkResponse, NetworkFailure>,
        Vec<NetworkMilestone>,
    ) {
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["fixture.example".into()]).unwrap();
        let certificate = cert.der().clone();
        let private_key =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(signing_key.serialize_der()));
        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let mut server_config = ServerConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![certificate.clone()], private_key)
            .unwrap();
        server_config.alpn_protocols = vec![b"http/1.1".to_vec()];
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (tcp, _) = listener.accept().unwrap();
            let connection = ServerConnection::new(Arc::new(server_config)).unwrap();
            let mut tls = StreamOwned::new(connection, tcp);
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match tls.read(&mut chunk) {
                    Ok(0) | Err(_) => return,
                    Ok(read) => request.extend_from_slice(&chunk[..read]),
                }
            }
            thread::sleep(delay);
            let _ = tls.write_all(&response);
            tls.conn.send_close_notify();
            let _ = tls.flush();
        });
        let roots = vec![certificate];
        let pin = trust_root_file_pin(&roots);
        let client = ProductionNetworkClient::from_roots(
            roots,
            &pin,
            Arc::new(FixtureResolver(vec!["127.0.0.1".parse().unwrap()])),
            true,
        )
        .unwrap();
        let mut milestones = Vec::new();
        let result = client.exchange(
            NetworkRequest {
                hostname: "fixture.example",
                port,
                method: "GET",
                path_query: "/",
                auth: None,
                body: b"",
                connect_deadline: Duration::from_secs(2),
                exchange_deadline: deadline,
                response_byte_cap: response_cap,
            },
            &mut |milestone| {
                milestones.push(milestone);
                Ok(())
            },
        );
        server.join().unwrap();
        (result, milestones)
    }

    #[test]
    fn whole_dns_answer_set_is_rejected_before_connect() {
        assert!(
            validate_dns_answers(&[
                "93.184.216.34".parse().unwrap(),
                "127.0.0.1".parse().unwrap(),
            ])
            .is_err()
        );
    }

    #[test]
    fn pinned_root_bytes_are_order_independent() {
        let a = CertificateDer::from(vec![1, 2, 3]);
        let b = CertificateDer::from(vec![4, 5]);
        assert_eq!(
            trust_root_file_pin(&[a.clone(), b.clone()]).sha256,
            trust_root_file_pin(&[a, b]).sha256
        );
        let _ = FixtureResolver(vec![IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)]);
    }

    #[test]
    fn production_constructor_rejects_an_unpinned_native_root_set() {
        assert!(matches!(
            ProductionNetworkClient::new(&FilePin {
                sha256: "0".repeat(64),
                bytes: 0,
                version: TRUST_ROOT_VERSION.into(),
            }),
            Err(NetworkFailure::Tls)
        ));
    }

    #[test]
    fn trust_root_file_pin_rejects_byte_count_and_version_substitution() {
        let rcgen::CertifiedKey { cert, .. } =
            rcgen::generate_simple_self_signed(vec!["fixture.example".into()]).unwrap();
        let roots = vec![cert.der().clone()];
        let mut pin = trust_root_file_pin(&roots);
        pin.bytes += 1;
        assert!(matches!(
            ProductionNetworkClient::from_roots(
                roots.clone(),
                &pin,
                Arc::new(FixtureResolver(vec!["127.0.0.1".parse().unwrap()])),
                true,
            ),
            Err(NetworkFailure::Tls)
        ));
        pin = trust_root_file_pin(&roots);
        pin.version = "substituted-root-serialization".into();
        assert!(matches!(
            ProductionNetworkClient::from_roots(
                roots,
                &pin,
                Arc::new(FixtureResolver(vec!["127.0.0.1".parse().unwrap()])),
                true,
            ),
            Err(NetworkFailure::Tls)
        ));
    }

    #[test]
    fn production_transport_uses_pinned_peer_tls13_sni_and_exact_framing() {
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["fixture.example".into()]).unwrap();
        let certificate = cert.der().clone();
        let private_key =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(signing_key.serialize_der()));
        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let mut server_config = ServerConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![certificate.clone()], private_key)
            .unwrap();
        server_config.alpn_protocols = vec![b"http/1.1".to_vec()];
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (tcp, _) = listener.accept().unwrap();
            let connection = ServerConnection::new(Arc::new(server_config)).unwrap();
            let mut tls = StreamOwned::new(connection, tcp);
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = tls.read(&mut chunk).unwrap();
                request.extend_from_slice(&chunk[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n")
                    && request.ends_with(br#"{"ok":true}"#)
                {
                    break;
                }
            }
            let text = String::from_utf8(request).unwrap();
            assert!(text.starts_with("POST /v1/exact?x=1 HTTP/1.1\r\naccept: application/json\r\ncontent-type: application/json\r\nauthorization: Bearer fixture-secret\r\nhost: fixture.example\r\ncontent-length: 11\r\nconnection: close\r\n\r\n"));
            tls.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"ok\":true}").unwrap();
            tls.conn.send_close_notify();
            tls.flush().unwrap();
        });
        let roots = vec![certificate];
        let pin = trust_root_file_pin(&roots);
        let client = ProductionNetworkClient::from_roots(
            roots,
            &pin,
            Arc::new(FixtureResolver(vec!["127.0.0.1".parse().unwrap()])),
            true,
        )
        .unwrap();
        let secret = SecretBytes::for_test(b"fixture-secret");
        let mut milestones = Vec::new();
        let response = client
            .exchange(
                NetworkRequest {
                    hostname: "fixture.example",
                    port,
                    method: "POST",
                    path_query: "/v1/exact?x=1",
                    auth: Some(AuthHeader::Bearer(&secret)),
                    body: br#"{"ok":true}"#,
                    connect_deadline: Duration::from_secs(2),
                    exchange_deadline: Duration::from_secs(5),
                    response_byte_cap: 11,
                },
                &mut |milestone| {
                    milestones.push(milestone);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, br#"{"ok":true}"#);
        assert!(matches!(
            milestones.as_slice(),
            [
                NetworkMilestone::DnsResolved { .. },
                NetworkMilestone::TlsVerified { .. },
                NetworkMilestone::RequestSent
            ]
        ));
        server.join().unwrap();
    }

    #[test]
    fn production_transport_rejects_certificate_for_another_sni_name() {
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["fixture.example".into()]).unwrap();
        let certificate = cert.der().clone();
        let private_key =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(signing_key.serialize_der()));
        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let mut server_config = ServerConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![certificate.clone()], private_key)
            .unwrap();
        server_config.alpn_protocols = vec![b"http/1.1".to_vec()];
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut tcp, _) = listener.accept().unwrap();
            let mut connection = ServerConnection::new(Arc::new(server_config)).unwrap();
            let _ = connection.complete_io(&mut tcp);
        });
        let roots = vec![certificate];
        let pin = trust_root_file_pin(&roots);
        let client = ProductionNetworkClient::from_roots(
            roots,
            &pin,
            Arc::new(FixtureResolver(vec!["127.0.0.1".parse().unwrap()])),
            true,
        )
        .unwrap();
        let mut milestones = Vec::new();
        let result = client.exchange(
            NetworkRequest {
                hostname: "wrong.example",
                port,
                method: "GET",
                path_query: "/",
                auth: None,
                body: b"",
                connect_deadline: Duration::from_secs(2),
                exchange_deadline: Duration::from_secs(5),
                response_byte_cap: 1,
            },
            &mut |milestone| {
                milestones.push(milestone);
                Ok(())
            },
        );
        assert!(matches!(result, Err(NetworkFailure::Tls)));
        assert!(matches!(
            milestones.as_slice(),
            [NetworkMilestone::DnsResolved { .. }]
        ));
        server.join().unwrap();
    }

    #[test]
    fn production_transport_exposes_policy_headers_without_following_or_decoding() {
        let redirect = fixture_exchange(
            b"HTTP/1.1 302 Found\r\ncontent-type: application/json\r\nlocation: https://other.example/\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}".to_vec(),
            Duration::ZERO,
            32,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(redirect.status, 302);
        assert_eq!(redirect.location.as_deref(), Some("https://other.example/"));

        let encoded = fixture_exchange(
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-encoding: gzip\r\ntransfer-encoding: chunked\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}".to_vec(),
            Duration::ZERO,
            32,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(encoded.content_encoding.as_deref(), Some("gzip"));
        assert_eq!(encoded.transfer_encoding.as_deref(), Some("chunked"));
        assert_eq!(encoded.body, b"{}");
    }

    #[test]
    fn production_transport_rejects_ambiguous_or_malformed_raw_framing() {
        let cases = [
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\ncontent-length: 2\r\n\r\n{}".to_vec(),
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: x\r\n\r\n{}".to_vec(),
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 5\r\n\r\n{}".to_vec(),
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}x".to_vec(),
            b"NOT-HTTP\r\n\r\n".to_vec(),
        ];
        for (index, response) in cases.into_iter().enumerate() {
            let result = fixture_exchange(response, Duration::ZERO, 32, Duration::from_secs(2));
            assert!(
                matches!(result, Err(NetworkFailure::Framing)),
                "raw framing case {index} returned {result:?}"
            );
        }
        assert!(matches!(
            fixture_exchange(
                b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 3\r\n\r\n{}x".to_vec(),
                Duration::ZERO,
                2,
                Duration::from_secs(2)
            ),
            Err(NetworkFailure::Overflow)
        ));
    }

    #[test]
    fn production_transport_enforces_deadline_and_dns_answer_set_before_connect() {
        let (timeout, milestones) = fixture_exchange_observed(
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}"
                .to_vec(),
            Duration::from_millis(100),
            32,
            Duration::from_millis(20),
        );
        assert!(matches!(timeout, Err(NetworkFailure::Deadline)));
        assert!(matches!(
            milestones.as_slice(),
            [
                NetworkMilestone::DnsResolved { .. },
                NetworkMilestone::TlsVerified { .. },
                NetworkMilestone::RequestSent,
            ]
        ));

        let rcgen::CertifiedKey { cert, .. } =
            rcgen::generate_simple_self_signed(vec!["fixture.example".into()]).unwrap();
        let roots = vec![cert.der().clone()];
        let pin = trust_root_file_pin(&roots);
        let client = ProductionNetworkClient::from_roots(
            roots,
            &pin,
            Arc::new(FixtureResolver(vec![
                "127.0.0.1".parse().unwrap(),
                "169.254.169.254".parse().unwrap(),
            ])),
            true,
        )
        .unwrap();
        assert!(matches!(
            client.exchange(
                NetworkRequest {
                    hostname: "fixture.example",
                    port: 443,
                    method: "GET",
                    path_query: "/",
                    auth: None,
                    body: b"",
                    connect_deadline: Duration::from_millis(10),
                    exchange_deadline: Duration::from_millis(10),
                    response_byte_cap: 1,
                },
                &mut |_| Ok(())
            ),
            Err(NetworkFailure::DnsForbidden)
        ));
    }
}
