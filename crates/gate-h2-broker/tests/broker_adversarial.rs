use std::{
    collections::{HashMap, VecDeque},
    io::Write,
    net::IpAddr,
    os::fd::RawFd,
    sync::{Arc, Mutex},
};

use gate_h2_broker::{
    Broker, BrokerConfig, NetworkClient, NetworkFailure, NetworkObservation, NetworkRequest,
    NetworkResponse,
    broker::socket_identity_commitment,
    credential::SecretBytes,
    evidence::{Clock, EvidenceWriter, canonical_json},
    model::{ExchangeRequest, Manifest, SchemaPin},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

const HANDLE: &str = "h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

#[derive(Default)]
struct ScriptedNetwork {
    responses: Mutex<VecDeque<Result<NetworkResponse, NetworkFailure>>>,
    seen: Mutex<Vec<SeenRequest>>,
}
#[derive(Debug)]
struct SeenRequest {
    hostname: String,
    method: String,
    path: String,
    headers: Vec<(String, Vec<u8>)>,
    body: Vec<u8>,
}
impl NetworkClient for ScriptedNetwork {
    fn exchange(&self, request: NetworkRequest<'_>) -> Result<NetworkResponse, NetworkFailure> {
        self.seen.lock().unwrap().push(SeenRequest {
            hostname: request.hostname.into(),
            method: request.method.into(),
            path: request.path_query.into(),
            headers: request
                .headers
                .into_iter()
                .map(|(k, v)| (k.into(), v))
                .collect(),
            body: request.body.to_vec(),
        });
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("script exhausted")
    }
}

struct StepClock(Mutex<u64>);
impl Clock for StepClock {
    fn now(&self) -> String {
        let mut n = self.0.lock().unwrap();
        let value = format!("2026-07-16T00:00:{:02}.000Z", *n);
        *n += 1;
        value
    }
}

fn success() -> NetworkResponse {
    NetworkResponse {
        observation: NetworkObservation {
            dns_answers: vec!["93.184.216.34".parse().unwrap()],
            connected_peer: "93.184.216.34".parse().unwrap(),
            tls_version: "TLSv1.3".into(),
            tls_peer_chain_sha256: "a".repeat(64),
            alpn: "http/1.1".into(),
        },
        status: 200,
        media_type: "application/json".into(),
        content_encoding: Some("identity".into()),
        content_length: Some(2),
        transfer_encoding: None,
        location: None,
        body: b"{}".to_vec(),
    }
}

fn manifest(body: &[u8], auth: Option<(&str, &str)>) -> Manifest {
    let path = format!(
        "{}/../../docs/dataset-factory/fixtures/https-exchange-contract-v1/manifest-v1.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let mut value: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let capability = &mut value["capabilities"][0];
    capability["request_artifact"]["bytes"] = (body.len() as u64).into();
    capability["request_artifact"]["sha256"] = hex::encode(Sha256::digest(body)).into();
    capability["request_byte_cap"] = (body.len() as u64).into();
    if let Some((scheme, commitment)) = auth {
        capability["auth_policy"]["scheme"] = scheme.into();
        capability["auth_policy"]["credential_capability_id"] = commitment.into();
        capability["auth_policy"]["header_name"] = (if scheme == "bearer" {
            "authorization"
        } else {
            "x-api-key"
        })
        .into();
        capability["auth_policy"]["insertion_order"] =
            "after_fixed_headers_before_transport_headers".into();
        capability["auth_policy"]["serialization"] = "lowercase_name_colon_sp_value_crlf".into();
        capability["auth_policy"]["collision_policy"] = "reject_before_serialization".into();
    }
    capability["capability_id"] = id(
        gate_h2_broker::policy::CAPABILITY_DOMAIN,
        capability,
        "capability_id",
    )
    .into();
    value["manifest_id"] = id(
        gate_h2_broker::policy::MANIFEST_DOMAIN,
        &value,
        "manifest_id",
    )
    .into();
    serde_json::from_value(value).unwrap()
}

fn id(domain: &[u8], value: &Value, field: &str) -> String {
    let mut object = value.as_object().unwrap().clone();
    object.remove(field);
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(canonical_json(&Value::Object(object)));
    hex::encode(hash.finalize())
}

fn secret(bytes: &[u8]) -> SecretBytes {
    let mut fds = [0 as RawFd; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    let mut writer = unsafe { std::fs::File::from_raw_fd(fds[1]) };
    writer.write_all(bytes).unwrap();
    drop(writer);
    SecretBytes::from_inherited_fd(fds[0], &hex::encode(Sha256::digest(bytes)), false).unwrap()
}

fn setup(
    response: Result<NetworkResponse, NetworkFailure>,
    auth: Option<(&str, &[u8])>,
) -> (Broker, TempDir, Arc<ScriptedNetwork>) {
    let temp = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let auth_info = auth.map(|(scheme, bytes)| (scheme, hex::encode(Sha256::digest(bytes))));
    let manifest = manifest(&body, auth_info.as_ref().map(|(a, b)| (*a, b.as_str())));
    let mut credentials = HashMap::new();
    if let Some((_, bytes)) = auth {
        credentials.insert(hex::encode(Sha256::digest(bytes)), secret(bytes));
    }
    let network = Arc::new(ScriptedNetwork {
        responses: Mutex::new(VecDeque::from([response])),
        seen: Mutex::new(Vec::new()),
    });
    let evidence = EvidenceWriter::new(
        temp.path().join("events"),
        secret(b"fixture-signing-key"),
        pin(
            "5c33ce7a3dcee39b87b65f6c8dd196c1a56b8fc8d31ef5ad30684735121e152f",
            3920,
            "gate_h2_https_broker_event_v1.0.0",
        ),
        pin(
            "15fc05df41acd422321ccf8e2b834526059f594424d5f675a7f0ce3248169db2",
            2045,
            "gate_h2_https_broker_transcript_v1.0.0",
        ),
    )
    .unwrap();
    let uid = unsafe { libc::geteuid() };
    let socket_identity_sha256 =
        socket_identity_commitment("session-1", "attempt-1", &manifest.manifest_id, uid);
    let config = BrokerConfig {
        manifest,
        expected_uid: uid,
        session_id: "session-1".into(),
        attempt_id: "attempt-1".into(),
        run_token: secret(TOKEN.as_bytes()),
        handles: vec![HANDLE.into()],
        request_bodies: vec![body],
        credentials,
        socket_identity_sha256,
        output_directory: temp.path().join("outputs"),
    };
    let broker = Broker::new(
        config,
        network.clone(),
        Arc::new(StepClock(Mutex::new(0))),
        evidence,
    )
    .unwrap();
    (broker, temp, network)
}

fn setup_two() -> (Broker, TempDir, Arc<ScriptedNetwork>, Manifest) {
    let temp = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let mut value = serde_json::to_value(manifest(&body, None)).unwrap();
    let mut second = value["capabilities"][0].clone();
    second["exchange_ordinal"] = 1.into();
    second["raw_response_output_role"] = "raw_https_response_2".into();
    second["capability_id"] = id(
        gate_h2_broker::policy::CAPABILITY_DOMAIN,
        &second,
        "capability_id",
    )
    .into();
    value["capabilities"].as_array_mut().unwrap().push(second);
    value["exact_exchange_count"] = 2.into();
    value["manifest_id"] = id(
        gate_h2_broker::policy::MANIFEST_DOMAIN,
        &value,
        "manifest_id",
    )
    .into();
    let manifest: Manifest = serde_json::from_value(value).unwrap();
    let network = Arc::new(ScriptedNetwork {
        responses: Mutex::new(VecDeque::from([Ok(success()), Ok(success())])),
        seen: Mutex::new(Vec::new()),
    });
    let evidence = EvidenceWriter::new(
        temp.path().join("events"),
        secret(b"fixture-signing-key"),
        pin(
            "5c33ce7a3dcee39b87b65f6c8dd196c1a56b8fc8d31ef5ad30684735121e152f",
            3920,
            "gate_h2_https_broker_event_v1.0.0",
        ),
        pin(
            "15fc05df41acd422321ccf8e2b834526059f594424d5f675a7f0ce3248169db2",
            2045,
            "gate_h2_https_broker_transcript_v1.0.0",
        ),
    )
    .unwrap();
    let uid = unsafe { libc::geteuid() };
    let socket_identity_sha256 =
        socket_identity_commitment("session-1", "attempt-1", &manifest.manifest_id, uid);
    let config = BrokerConfig {
        manifest: manifest.clone(),
        expected_uid: uid,
        session_id: "session-1".into(),
        attempt_id: "attempt-1".into(),
        run_token: secret(TOKEN.as_bytes()),
        handles: vec![HANDLE.into(), format!("h2h_{}", "B".repeat(32))],
        request_bodies: vec![body.clone(), body],
        credentials: HashMap::new(),
        socket_identity_sha256,
        output_directory: temp.path().join("outputs"),
    };
    (
        Broker::new(
            config,
            network.clone(),
            Arc::new(StepClock(Mutex::new(0))),
            evidence,
        )
        .unwrap(),
        temp,
        network,
        manifest,
    )
}

fn pin(hash: &str, bytes: u64, version: &str) -> SchemaPin {
    SchemaPin {
        sha256: hash.into(),
        bytes,
        schema_version: version.into(),
    }
}
fn request(broker: &Broker) -> ExchangeRequest {
    let c = &broker_manifest(broker).capabilities[0];
    ExchangeRequest {
        schema_version: gate_h2_broker::PROTOCOL_VERSION.into(),
        message_type: "exchange_request".into(),
        request_id: "0123456789abcdef0123456789abcdef".into(),
        run_token: TOKEN.into(),
        capability_handle: HANDLE.into(),
        request_artifact_role: c.request_artifact.artifact_role.clone(),
        request_artifact_sha256: c.request_artifact.sha256.clone(),
        request_artifact_bytes: c.request_artifact.bytes,
    }
}

// The public API deliberately does not expose the authority manifest. Tests derive the same pin.
fn valid_request() -> ExchangeRequest {
    let m = manifest(&[b'x'; 128], None);
    let c = &m.capabilities[0];
    ExchangeRequest {
        schema_version: gate_h2_broker::PROTOCOL_VERSION.into(),
        message_type: "exchange_request".into(),
        request_id: "0123456789abcdef0123456789abcdef".into(),
        run_token: TOKEN.into(),
        capability_handle: HANDLE.into(),
        request_artifact_role: c.request_artifact.artifact_role.clone(),
        request_artifact_sha256: c.request_artifact.sha256.clone(),
        request_artifact_bytes: c.request_artifact.bytes,
    }
}
fn broker_manifest(_: &Broker) -> Manifest {
    manifest(&[b'x'; 128], None)
}
fn capability_id() -> String {
    manifest(&[b'x'; 128], None).capabilities[0]
        .capability_id
        .clone()
}

#[test]
fn success_commits_exact_request_output_events_and_signed_transcript() {
    let (mut broker, temp, network) = setup(Ok(success()), None);
    let response = broker.exchange(&capability_id(), request(&broker)).unwrap();
    assert_eq!(response.outcome, "accepted");
    assert_eq!(
        response.output_artifact.unwrap().sha256,
        hex::encode(Sha256::digest(b"{}"))
    );
    let seen = network.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        (&seen[0].hostname, &seen[0].method, &seen[0].path),
        (
            &"api.example.net".into(),
            &"POST".into(),
            &"/v1/exchange?mode=exact&sample=1".into()
        )
    );
    assert_eq!(seen[0].body, vec![b'x'; 128]);
    assert_eq!(
        seen[0]
            .headers
            .iter()
            .map(|v| v.0.as_str())
            .collect::<Vec<_>>(),
        ["accept", "content-type"]
    );
    drop(seen);
    assert_eq!(
        broker
            .evidence
            .events
            .iter()
            .map(|v| v.event_type)
            .collect::<Vec<_>>(),
        [
            "handle_consumed",
            "dns_resolved",
            "tls_verified",
            "request_sent",
            "response_committed"
        ]
    );
    broker.seal_transcript().unwrap();
    assert!(temp.path().join("outputs/raw_https_response.json").exists());
    assert!(
        temp.path()
            .join("events/transcript.signature.json")
            .exists()
    );
}

#[test]
fn invalid_token_and_handle_never_reach_transport() {
    let (mut broker, _temp, network) = setup(Ok(success()), None);
    let mut r = valid_request();
    r.run_token = "B".repeat(43);
    assert_eq!(
        broker
            .exchange(&capability_id(), r)
            .unwrap()
            .failure_code
            .as_deref(),
        Some("invalid_token")
    );
    assert!(broker.is_terminal());
    assert_eq!(
        broker.evidence.events.last().unwrap().event_type,
        "exchange_failed"
    );
    assert!(network.seen.lock().unwrap().is_empty());

    let (mut broker, _temp, network) = setup(Ok(success()), None);
    let mut r = valid_request();
    r.capability_handle = format!("h2h_{}", "B".repeat(32));
    assert_eq!(
        broker
            .exchange(&capability_id(), r)
            .unwrap()
            .failure_code
            .as_deref(),
        Some("invalid_handle")
    );
    assert!(network.seen.lock().unwrap().is_empty());
}

#[test]
fn artifact_mismatch_consumes_handle_and_replay_is_denied() {
    let (mut broker, _temp, network) = setup(Ok(success()), None);
    let mut r = valid_request();
    r.request_artifact_bytes += 1;
    assert_eq!(
        broker
            .exchange(&capability_id(), r)
            .unwrap()
            .failure_code
            .as_deref(),
        Some("request_artifact_mismatch")
    );
    assert_eq!(
        broker
            .exchange(&capability_id(), valid_request())
            .unwrap()
            .failure_code
            .as_deref(),
        Some("replay")
    );
    assert!(network.seen.lock().unwrap().is_empty());
}

#[test]
fn handles_are_strictly_ordered_and_single_use() {
    let (mut broker, _temp, network, manifest) = setup_two();
    let mut second = valid_request();
    second.capability_handle = format!("h2h_{}", "B".repeat(32));
    assert_eq!(
        broker
            .exchange(&manifest.capabilities[1].capability_id, second)
            .unwrap()
            .failure_code
            .as_deref(),
        Some("out_of_order")
    );
    assert_eq!(
        broker
            .exchange(&manifest.capabilities[0].capability_id, valid_request())
            .unwrap()
            .outcome,
        "accepted"
    );
    assert_eq!(
        broker
            .exchange(&manifest.capabilities[0].capability_id, valid_request())
            .unwrap()
            .failure_code
            .as_deref(),
        Some("replay")
    );
    assert_eq!(network.seen.lock().unwrap().len(), 1);
}

#[test]
fn all_transport_failures_are_single_attempt_and_hash_only() {
    for (failure, code) in [
        (NetworkFailure::DnsForbidden, "dns_forbidden"),
        (NetworkFailure::DnsRebinding, "dns_rebinding"),
        (NetworkFailure::Tls, "tls_failure"),
        (NetworkFailure::Deadline, "deadline_exceeded"),
        (NetworkFailure::Framing, "protocol_error"),
        (NetworkFailure::Overflow, "response_too_large"),
    ] {
        let (mut broker, _temp, network) = setup(Err(failure), None);
        let response = broker.exchange(&capability_id(), valid_request()).unwrap();
        assert_eq!(response.failure_code.as_deref(), Some(code));
        assert_eq!(network.seen.lock().unwrap().len(), 1);
        assert_eq!(
            broker.evidence.events.last().unwrap().event_type,
            "exchange_failed"
        );
    }
}

#[test]
fn dns_rebinding_and_forbidden_mixed_answers_fail_closed() {
    let mut forbidden = success();
    forbidden
        .observation
        .dns_answers
        .push("127.0.0.1".parse().unwrap());
    let (mut broker, _temp, _network) = setup(Ok(forbidden), None);
    assert_eq!(
        broker
            .exchange(&capability_id(), valid_request())
            .unwrap()
            .failure_code
            .as_deref(),
        Some("dns_forbidden")
    );
    let mut rebound = success();
    rebound.observation.connected_peer = "1.1.1.1".parse::<IpAddr>().unwrap();
    let (mut broker, _temp, _network) = setup(Ok(rebound), None);
    assert_eq!(
        broker
            .exchange(&capability_id(), valid_request())
            .unwrap()
            .failure_code
            .as_deref(),
        Some("dns_rebinding")
    );
}

#[test]
fn redirect_compression_status_type_overflow_and_framing_are_denied() {
    type ResponseMutation = Box<dyn Fn(&mut NetworkResponse)>;
    let cases: Vec<(ResponseMutation, &str)> = vec![
        (
            Box::new(|r| {
                r.status = 302;
                r.location = Some("https://other.invalid".into())
            }),
            "redirect_forbidden",
        ),
        (
            Box::new(|r| r.content_encoding = Some("gzip".into())),
            "protocol_error",
        ),
        (Box::new(|r| r.status = 201), "response_status_forbidden"),
        (
            Box::new(|r| r.media_type = "text/plain".into()),
            "response_type_forbidden",
        ),
        (
            Box::new(|r| {
                r.body = vec![0; 1_048_577];
                r.content_length = Some(r.body.len() as u64)
            }),
            "response_too_large",
        ),
        (Box::new(|r| r.content_length = None), "protocol_error"),
        (
            Box::new(|r| r.transfer_encoding = Some("chunked".into())),
            "protocol_error",
        ),
    ];
    for (mutate, code) in cases {
        let mut response = success();
        mutate(&mut response);
        let (mut broker, _temp, network) = setup(Ok(response), None);
        assert_eq!(
            broker
                .exchange(&capability_id(), valid_request())
                .unwrap()
                .failure_code
                .as_deref(),
            Some(code)
        );
        assert_eq!(network.seen.lock().unwrap().len(), 1);
    }
}

#[test]
fn auth_is_typed_inserted_after_fixed_headers_and_never_emitted() {
    let credential = b"fixture-secret-value";
    let commitment = hex::encode(Sha256::digest(credential));
    let (mut broker, temp, network) = setup(Ok(success()), Some(("bearer", credential)));
    let m = manifest(&[b'x'; 128], Some(("bearer", &commitment)));
    let c = m.capabilities[0].capability_id.clone();
    let response = broker.exchange(&c, valid_request()).unwrap();
    assert_eq!(response.outcome, "accepted");
    let seen = network.seen.lock().unwrap();
    assert_eq!(seen[0].headers[2].0, "authorization");
    assert_eq!(seen[0].headers[2].1, b"Bearer fixture-secret-value");
    drop(seen);
    broker.seal_transcript().unwrap();
    for entry in walkdir(temp.path()) {
        let bytes = std::fs::read(entry).unwrap();
        assert!(!bytes.windows(credential.len()).any(|v| v == credential));
    }
}

fn walkdir(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(walkdir(&path));
        } else {
            files.push(path);
        }
    }
    files
}

use std::os::fd::FromRawFd;
