use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::SigningKey;
use sha2::{Digest, Sha256};

use crate::{
    Broker, BrokerConfig,
    credential::SecretBytes,
    evidence::{AuthorityBindings, Clock, EvidenceWriter},
    model::{AuthScheme, ExchangeRequest, ExchangeResponse, FilePin, Manifest, SchemaPin},
    network::{
        AuthHeader, NetworkClient, NetworkFailure, NetworkMilestone, NetworkRequest,
        NetworkResponse,
    },
    policy::{CAPABILITY_DOMAIN, MANIFEST_DOMAIN, object_id},
};

const HANDLE: &str = "h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

fn assert_uds_response_schema(response: &ExchangeResponse) {
    let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut child = Command::new("node")
        .arg(repository.join("crates/gate-h2-broker/scripts/validate-uds-response.mjs"))
        .current_dir(&repository)
        .stdin(Stdio::piped())
        .spawn()
        .expect("Node.js is required by the repository contract validators");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(response).unwrap())
        .unwrap();
    assert!(
        child.wait().unwrap().success(),
        "exchange_response failed the frozen JSON Schema: {response:?}"
    );
}

fn response_from_http(bytes: &[u8]) -> ExchangeResponse {
    let body = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| &bytes[index + 4..])
        .expect("complete HTTP response headers");
    serde_json::from_slice(body).unwrap()
}

struct ScriptedNetwork;
impl NetworkClient for ScriptedNetwork {
    fn exchange(
        &self,
        request: NetworkRequest<'_>,
        milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
    ) -> Result<NetworkResponse, NetworkFailure> {
        assert_eq!(request.hostname, "api.example.net");
        assert_eq!(request.port, 443);
        assert_eq!(request.method, "POST");
        assert_eq!(request.path_query, "/v1/exchange?mode=exact&sample=1");
        assert!(request.auth.is_none());
        assert_eq!(request.body.len(), 128);
        assert_eq!(request.connect_deadline, Duration::from_secs(5));
        assert_eq!(request.exchange_deadline, Duration::from_secs(30));
        assert_eq!(request.response_byte_cap, 1_048_576);
        emit_success_milestones(milestone)?;
        Ok(NetworkResponse {
            status: 200,
            media_type: "application/json".into(),
            content_encoding: None,
            content_length: Some(11),
            transfer_encoding: None,
            location: None,
            body: br#"{"ok":true}"#.to_vec(),
        })
    }
}

struct PostSendFailureNetwork;
impl NetworkClient for PostSendFailureNetwork {
    fn exchange(
        &self,
        _: NetworkRequest<'_>,
        milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
    ) -> Result<NetworkResponse, NetworkFailure> {
        emit_success_milestones(milestone)?;
        Err(NetworkFailure::Deadline)
    }
}

struct QueuedNetwork {
    responses: Mutex<VecDeque<Result<NetworkResponse, NetworkFailure>>>,
    calls: Mutex<usize>,
    observed_auth: Mutex<Vec<Option<Vec<u8>>>>,
}

impl QueuedNetwork {
    fn new(responses: impl IntoIterator<Item = Result<NetworkResponse, NetworkFailure>>) -> Self {
        Self {
            responses: Mutex::new(responses.into_iter().collect()),
            calls: Mutex::new(0),
            observed_auth: Mutex::new(Vec::new()),
        }
    }

    fn call_count(&self) -> usize {
        *self.calls.lock().unwrap()
    }
}

impl NetworkClient for QueuedNetwork {
    fn exchange(
        &self,
        request: NetworkRequest<'_>,
        milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
    ) -> Result<NetworkResponse, NetworkFailure> {
        *self.calls.lock().unwrap() += 1;
        let auth = match request.auth {
            None => None,
            Some(AuthHeader::Bearer(secret) | AuthHeader::ApiKey(secret)) => {
                Some(secret.expose().to_vec())
            }
        };
        self.observed_auth.lock().unwrap().push(auth);
        let result = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted response exhausted");
        if result.is_ok() {
            emit_success_milestones(milestone)?;
        }
        result
    }
}

struct TestClock(Mutex<VecDeque<String>>);
impl Clock for TestClock {
    fn now(&self) -> String {
        self.0.lock().unwrap().pop_front().unwrap()
    }
}

fn clock() -> Arc<dyn Clock> {
    Arc::new(TestClock(Mutex::new(VecDeque::from([
        "2026-07-17T05:00:00.000Z".into(),
        "2026-07-17T05:00:00.001Z".into(),
        "2026-07-17T05:00:00.002Z".into(),
        "2026-07-17T05:00:00.003Z".into(),
        "2026-07-17T05:00:00.004Z".into(),
        "2026-07-17T05:00:00.005Z".into(),
        "2026-07-17T05:00:00.006Z".into(),
        "2026-07-17T05:00:00.007Z".into(),
        "2026-07-17T05:00:00.008Z".into(),
        "2026-07-17T05:00:00.009Z".into(),
        "2026-07-17T05:00:00.010Z".into(),
        "2026-07-17T05:00:00.011Z".into(),
    ]))))
}

fn success() -> NetworkResponse {
    NetworkResponse {
        status: 200,
        media_type: "application/json".into(),
        content_encoding: None,
        content_length: Some(11),
        transfer_encoding: None,
        location: None,
        body: br#"{"ok":true}"#.to_vec(),
    }
}

fn emit_success_milestones(
    milestone: &mut dyn FnMut(NetworkMilestone) -> Result<(), NetworkFailure>,
) -> Result<(), NetworkFailure> {
    milestone(NetworkMilestone::DnsResolved {
        dns_answers: vec!["93.184.216.34".parse().unwrap()],
        connection_target: "93.184.216.34".parse().unwrap(),
    })?;
    milestone(NetworkMilestone::TlsVerified {
        tls_peer_chain_sha256: "5".repeat(64),
    })?;
    milestone(NetworkMilestone::RequestSent)
}

fn manifest(body: &[u8]) -> Manifest {
    let mut manifest: Manifest = serde_json::from_str(include_str!(
        "../../../docs/dataset-factory/fixtures/https-exchange-contract-v1/manifest-v1.json"
    ))
    .unwrap();
    let capability = &mut manifest.capabilities[0];
    capability.request_artifact.sha256 = hex::encode(Sha256::digest(body));
    capability.request_artifact.bytes = body.len() as u64;
    capability.request_byte_cap = body.len() as u64;
    capability.capability_id = object_id(CAPABILITY_DOMAIN, capability, "capability_id").unwrap();
    manifest.manifest_id = object_id(MANIFEST_DOMAIN, &manifest, "manifest_id").unwrap();
    manifest
}

fn schema_pin(sha256: &str, bytes: u64, version: &str) -> SchemaPin {
    SchemaPin {
        sha256: sha256.into(),
        bytes,
        schema_version: version.into(),
    }
}

fn file_pin(byte: char, version: &str) -> FilePin {
    FilePin {
        sha256: byte.to_string().repeat(64),
        bytes: 1,
        version: version.into(),
    }
}

fn broker(root: &std::path::Path) -> Broker {
    let body = vec![b'x'; 128];
    let manifest = manifest(&body);
    broker_with_network(
        root,
        manifest,
        Arc::new(ScriptedNetwork),
        vec![HANDLE.into()],
        vec![body],
        HashMap::new(),
    )
}

fn broker_with_network(
    root: &std::path::Path,
    manifest: Manifest,
    network: Arc<dyn NetworkClient>,
    handles: Vec<String>,
    request_bodies: Vec<Vec<u8>>,
    credentials: HashMap<String, SecretBytes>,
) -> Broker {
    let session_id = "session_1".to_owned();
    let attempt_id = "attempt_1".to_owned();
    let uid = unsafe { libc::geteuid() };
    let socket_identity_sha256 = crate::broker::socket_identity_commitment(
        &session_id,
        &attempt_id,
        &manifest.manifest_id,
        uid,
    );
    let seed = [7_u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = URL_SAFE_NO_PAD.encode(signing_key.verifying_key().as_bytes());
    let signer_id = hex::encode(Sha256::digest(
        [
            b"gate-h2-ed25519-signer-v1\0".as_slice(),
            public_key.as_bytes(),
        ]
        .concat(),
    ));
    let evidence = EvidenceWriter::new(
        root.join("evidence"),
        SecretBytes::for_test(URL_SAFE_NO_PAD.encode(seed).as_bytes()),
        schema_pin(
            "5c33ce7a3dcee39b87b65f6c8dd196c1a56b8fc8d31ef5ad30684735121e152f",
            3920,
            crate::EVENT_VERSION,
        ),
        schema_pin(
            "15fc05df41acd422321ccf8e2b834526059f594424d5f675a7f0ce3248169db2",
            2045,
            crate::TRANSCRIPT_VERSION,
        ),
        AuthorityBindings {
            schema_pin: schema_pin(
                "d7752a9c8325ed7537a58cbe3515cee146e5fb1c122c7a536d1ed8eedf79e079",
                2697,
                "gate_h2_https_broker_authority_envelope_v2.0.0",
            ),
            d1_attempt_id: "d1_attempt_1".into(),
            d1_begin_sha256: "6".repeat(64),
            session_id: session_id.clone(),
            attempt_id: attempt_id.clone(),
            broker_binary: file_pin('1', "broker-v1"),
            stage_runtime: file_pin('2', "runtime-v1"),
            trust_roots: file_pin('3', "roots-v1"),
            signer_id,
            signer_trust_entry_sha256: "4".repeat(64),
        },
    )
    .unwrap();
    Broker::new_for_test(
        BrokerConfig {
            manifest,
            expected_uid: uid,
            session_id,
            attempt_id,
            run_token: SecretBytes::for_test(TOKEN.as_bytes()),
            handles,
            request_bodies,
            credentials,
            socket_identity_sha256,
            output_directory: root.join("outputs"),
        },
        network,
        clock(),
        evidence,
    )
    .unwrap()
}

fn request(manifest: &Manifest) -> ExchangeRequest {
    let capability = &manifest.capabilities[0];
    ExchangeRequest {
        schema_version: crate::PROTOCOL_VERSION.into(),
        message_type: "exchange_request".into(),
        request_id: "a".repeat(32),
        run_token: TOKEN.into(),
        capability_handle: HANDLE.into(),
        request_artifact_role: capability.request_artifact.artifact_role.clone(),
        request_artifact_sha256: capability.request_artifact.sha256.clone(),
        request_artifact_bytes: capability.request_artifact.bytes,
    }
}

#[test]
fn invalid_admission_inputs_consume_once_and_never_reach_transport() {
    for (mutate, expected) in [
        ("protocol", "protocol_error"),
        ("token", "invalid_token"),
        ("handle", "invalid_handle"),
        ("artifact", "request_artifact_mismatch"),
    ] {
        let root = tempfile::tempdir().unwrap();
        let body = vec![b'x'; 128];
        let manifest = manifest(&body);
        let network = Arc::new(QueuedNetwork::new([Ok(success())]));
        let mut broker = broker_with_network(
            root.path(),
            manifest.clone(),
            network.clone(),
            vec![HANDLE.into()],
            vec![body],
            HashMap::new(),
        );
        let mut exchange = request(&manifest);
        match mutate {
            "protocol" => exchange.message_type = "unknown".into(),
            "token" => exchange.run_token = "B".repeat(43),
            "handle" => exchange.capability_handle = "h2h_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".into(),
            "artifact" => exchange.request_artifact_sha256 = "0".repeat(64),
            _ => unreachable!(),
        }
        let response = broker
            .exchange(&manifest.capabilities[0].capability_id, exchange)
            .unwrap();
        assert_uds_response_schema(&response);
        assert_eq!(response.failure_code.as_deref(), Some(expected));
        assert!(response.exchange_consumed);
        assert!(broker.is_terminal());
        assert_eq!(network.call_count(), 0);
        assert_eq!(broker.evidence.events[0].event_type, "handle_consumed");
        assert_eq!(broker.evidence.events[1].event_type, "exchange_failed");
        broker.seal_transcript().unwrap();
    }
}

#[test]
fn transport_failures_are_single_attempt_and_terminal() {
    for (failure, expected) in [
        (NetworkFailure::DnsForbidden, "dns_forbidden"),
        (NetworkFailure::DnsRebinding, "dns_rebinding"),
        (NetworkFailure::Tls, "tls_failure"),
        (NetworkFailure::Deadline, "deadline_exceeded"),
        (NetworkFailure::Framing, "protocol_error"),
        (NetworkFailure::Overflow, "response_too_large"),
    ] {
        let root = tempfile::tempdir().unwrap();
        let body = vec![b'x'; 128];
        let manifest = manifest(&body);
        let network = Arc::new(QueuedNetwork::new([Err(failure)]));
        let mut broker = broker_with_network(
            root.path(),
            manifest.clone(),
            network.clone(),
            vec![HANDLE.into()],
            vec![body],
            HashMap::new(),
        );
        let response = broker
            .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
            .unwrap();
        assert_uds_response_schema(&response);
        assert_eq!(response.failure_code.as_deref(), Some(expected));
        assert_eq!(network.call_count(), 1);
        assert!(broker.is_terminal());
    }
}

#[test]
fn failure_after_request_transmission_preserves_fsynced_truthful_prefix_and_timestamp_order() {
    let root = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let manifest = manifest(&body);
    let mut broker = broker_with_network(
        root.path(),
        manifest.clone(),
        Arc::new(PostSendFailureNetwork),
        vec![HANDLE.into()],
        vec![body],
        HashMap::new(),
    );
    let response = broker
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&response);
    assert_eq!(response.failure_code.as_deref(), Some("deadline_exceeded"));
    let event_types = broker
        .evidence
        .events
        .iter()
        .map(|event| event.event_type)
        .collect::<Vec<_>>();
    assert_eq!(
        event_types,
        [
            "handle_consumed",
            "dns_resolved",
            "tls_verified",
            "request_sent",
            "exchange_failed"
        ]
    );
    let occurred = broker
        .evidence
        .events
        .iter()
        .map(|event| event.occurred_at.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        occurred,
        [
            "2026-07-17T05:00:00.001Z",
            "2026-07-17T05:00:00.002Z",
            "2026-07-17T05:00:00.003Z",
            "2026-07-17T05:00:00.004Z",
            "2026-07-17T05:00:00.005Z",
        ]
    );
    for sequence in 0..5 {
        assert!(
            root.path()
                .join(format!("evidence/event-{sequence:04}.json"))
                .is_file()
        );
    }
    broker.seal_transcript().unwrap();
}

#[test]
fn output_commit_failure_uses_schema_code_but_preserves_precise_transcript_diagnostic() {
    let root = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let manifest = manifest(&body);
    std::fs::write(root.path().join("outputs"), b"not a directory").unwrap();
    let mut broker = broker_with_network(
        root.path(),
        manifest.clone(),
        Arc::new(QueuedNetwork::new([Ok(success())])),
        vec![HANDLE.into()],
        vec![body],
        HashMap::new(),
    );
    let response = broker
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&response);
    assert_eq!(response.outcome, "failed_closed");
    assert_eq!(response.failure_code.as_deref(), Some("protocol_error"));
    assert!(response.output_artifact.is_none());
    assert_eq!(
        broker.evidence.events.last().unwrap().evidence["failure_code"],
        "output_commit_failed"
    );
    broker.seal_transcript().unwrap();
}

#[test]
fn empty_output_success_conforms_to_the_frozen_uds_schema() {
    let root = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let manifest = manifest(&body);
    let mut empty = success();
    empty.body.clear();
    empty.content_length = Some(0);
    let mut broker = broker_with_network(
        root.path(),
        manifest.clone(),
        Arc::new(QueuedNetwork::new([Ok(empty)])),
        vec![HANDLE.into()],
        vec![body],
        HashMap::new(),
    );
    let response = broker
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&response);
    assert_eq!(response.output_artifact.as_ref().unwrap().bytes, 0);
}

#[test]
fn untrusted_transport_responses_fail_closed() {
    let mut cases = Vec::new();
    let mut redirect = success();
    redirect.status = 302;
    redirect.location = Some("https://other.example/".into());
    cases.push((redirect, "redirect_forbidden"));
    let mut compressed = success();
    compressed.content_encoding = Some("gzip".into());
    cases.push((compressed, "protocol_error"));
    let mut malformed = success();
    malformed.content_length = Some(12);
    cases.push((malformed, "protocol_error"));
    let mut status = success();
    status.status = 201;
    cases.push((status, "response_status_forbidden"));
    let mut media = success();
    media.media_type = "text/plain".into();
    cases.push((media, "response_type_forbidden"));
    let mut overflow = success();
    overflow.body = vec![b'x'; 1_048_577];
    overflow.content_length = Some(overflow.body.len() as u64);
    cases.push((overflow, "response_too_large"));

    for (network_response, expected) in cases {
        let root = tempfile::tempdir().unwrap();
        let body = vec![b'x'; 128];
        let manifest = manifest(&body);
        let network = Arc::new(QueuedNetwork::new([Ok(network_response)]));
        let mut broker = broker_with_network(
            root.path(),
            manifest.clone(),
            network.clone(),
            vec![HANDLE.into()],
            vec![body],
            HashMap::new(),
        );
        let response = broker
            .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
            .unwrap();
        assert_uds_response_schema(&response);
        assert_eq!(response.failure_code.as_deref(), Some(expected));
        assert_eq!(network.call_count(), 1);
        assert!(broker.is_terminal());
    }
}

#[test]
fn handles_remain_strictly_ordered_single_use_capabilities() {
    let body = vec![b'x'; 128];
    let mut manifest = manifest(&body);
    let mut second = manifest.capabilities[0].clone();
    second.exchange_ordinal = 1;
    second.raw_response_output_role = "raw_https_response_2".into();
    second.capability_id = object_id(CAPABILITY_DOMAIN, &second, "capability_id").unwrap();
    manifest.capabilities.push(second);
    manifest.exact_exchange_count = 2;
    manifest.manifest_id = object_id(MANIFEST_DOMAIN, &manifest, "manifest_id").unwrap();
    let handles = vec![HANDLE.into(), "h2h_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".into()];

    let root = tempfile::tempdir().unwrap();
    let denied_network = Arc::new(QueuedNetwork::new([Ok(success())]));
    let mut denied = broker_with_network(
        root.path(),
        manifest.clone(),
        denied_network.clone(),
        handles.clone(),
        vec![body.clone(), body.clone()],
        HashMap::new(),
    );
    let mut second_request = request(&manifest);
    second_request.capability_handle = handles[1].clone();
    let denied_response = denied
        .exchange(&manifest.capabilities[1].capability_id, second_request)
        .unwrap();
    assert_uds_response_schema(&denied_response);
    assert_eq!(
        denied_response.failure_code.as_deref(),
        Some("out_of_order")
    );
    assert_eq!(denied_network.call_count(), 0);

    let root = tempfile::tempdir().unwrap();
    let network = Arc::new(QueuedNetwork::new([Ok(success()), Ok(success())]));
    let mut allowed = broker_with_network(
        root.path(),
        manifest.clone(),
        network.clone(),
        handles.clone(),
        vec![body.clone(), body],
        HashMap::new(),
    );
    let first = allowed
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&first);
    let replay = allowed
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&replay);
    assert_eq!(replay.failure_code.as_deref(), Some("replay"));
    assert_eq!(network.call_count(), 1);
    assert!(
        allowed
            .exchange(&manifest.capabilities[1].capability_id, request(&manifest))
            .is_err(),
        "a terminal broker must not construct an exchange_response with exchange_consumed=false"
    );
}

#[test]
fn typed_auth_reaches_only_transport_and_never_evidence() {
    let root = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let mut manifest = manifest(&body);
    let credential_id = "c".repeat(64);
    let capability = &mut manifest.capabilities[0];
    capability.auth_policy.scheme = AuthScheme::Bearer;
    capability.auth_policy.credential_capability_id = credential_id.clone();
    capability.auth_policy.header_name = Some("authorization".into());
    capability.auth_policy.insertion_order = "after_fixed_headers_before_transport_headers".into();
    capability.auth_policy.serialization = "lowercase_name_colon_sp_value_crlf".into();
    capability.auth_policy.collision_policy = "reject_before_serialization".into();
    capability.capability_id = object_id(CAPABILITY_DOMAIN, capability, "capability_id").unwrap();
    manifest.manifest_id = object_id(MANIFEST_DOMAIN, &manifest, "manifest_id").unwrap();
    let network = Arc::new(QueuedNetwork::new([Ok(success())]));
    let secret = b"fixture-secret-value";
    let mut credentials = HashMap::new();
    credentials.insert(credential_id, SecretBytes::for_test(secret));
    let mut broker = broker_with_network(
        root.path(),
        manifest.clone(),
        network.clone(),
        vec![HANDLE.into()],
        vec![body],
        credentials,
    );
    broker
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    broker.seal_transcript().unwrap();
    assert_eq!(
        network.observed_auth.lock().unwrap().as_slice(),
        &[Some(secret.to_vec())]
    );
    for entry in std::fs::read_dir(root.path().join("evidence")).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        assert!(!bytes.windows(secret.len()).any(|window| window == secret));
    }
}

#[test]
fn successful_exchange_emits_v1_transcript_and_ed25519_authority_envelope() {
    let root = tempfile::tempdir().unwrap();
    let mut broker = broker(root.path());
    let manifest = broker.manifest().clone();
    let response = broker
        .exchange(&manifest.capabilities[0].capability_id, request(&manifest))
        .unwrap();
    assert_uds_response_schema(&response);
    assert_eq!(response.outcome, "accepted");
    broker.seal_transcript().unwrap();
    std::fs::write(
        root.path().join("manifest.json"),
        crate::evidence::canonical_json(&serde_json::to_value(&manifest).unwrap()),
    )
    .unwrap();
    assert!(root.path().join("evidence/transcript.v1.json").is_file());
    let envelope: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("evidence/transcript.authority.v2.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(envelope["signature_algorithm"], "ed25519");
    assert_eq!(envelope["final_outcome"], "complete");
    if std::env::var_os("GATE_H2_RUN_TS_ORACLE").is_some() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let status =
            std::process::Command::new(repository.join("node_modules/.bin/tsx"))
                .arg(repository.join(
                    "packages/scripts/src/dataset-factory/validate-broker-runtime-artifacts.ts",
                ))
                .arg(root.path().join("manifest.json"))
                .arg(root.path().join("evidence/transcript.v1.json"))
                .arg(root.path().join("evidence/transcript.authority.v2.json"))
                .arg("4".repeat(64))
                .current_dir(&repository)
                .status()
                .unwrap();
        assert!(status.success(), "#98 TypeScript artifact oracle failed");
    }
}

#[test]
fn uds_serve_runs_end_to_end_and_seals_terminal_evidence() {
    let root = tempfile::tempdir().unwrap();
    let broker = broker(root.path());
    let manifest = broker.manifest().clone();
    let request = request(&manifest);
    let body = serde_json::to_vec(&request).unwrap();
    let directory = root.path().join("socket_1");
    let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
    let state = Arc::new(Mutex::new(broker));
    let server_state = Arc::clone(&state);
    let server = std::thread::spawn(move || crate::uds::serve(listener, server_state).unwrap());
    let mut stream =
        std::os::unix::net::UnixStream::connect(directory.join("broker.sock")).unwrap();
    write!(
        stream,
        "POST /v1/exchange/{} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        manifest.capabilities[0].capability_id,
        body.len()
    )
    .unwrap();
    stream.write_all(&body).unwrap();
    stream.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert_uds_response_schema(&response_from_http(&response));
    server.join().unwrap();
    assert!(root.path().join("evidence/transcript.v1.json").is_file());
    drop(guard);
}

#[test]
fn real_broker_uds_and_stage_runtime_preserve_exact_binary_and_empty_outputs() {
    use std::os::unix::fs::PermissionsExt;
    for (name, payload) in [
        ("binary", vec![0, 1, 255, b'\n', 0, 127]),
        ("no_newline", b"exact-without-newline".to_vec()),
        ("with_newline", b"exact-with-newline\n".to_vec()),
        ("empty", Vec::new()),
    ] {
        let root = tempfile::tempdir().unwrap();
        let run_root = root.path().join("run");
        for directory in [root.path().join("inputs"), root.path().join("outputs")] {
            std::fs::create_dir(&directory).unwrap();
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let program = include_bytes!(
            "../../../docs/dataset-factory/fixtures/https-exchange-contract-v1/stage-program-v2.2.json"
        );
        std::fs::write(root.path().join("program.json"), program).unwrap();
        let request_body = b"{}".to_vec();
        std::fs::write(
            root.path().join("inputs/reviewed_request_body.json"),
            &request_body,
        )
        .unwrap();

        let manifest = manifest(&request_body);
        let response = NetworkResponse {
            status: 200,
            media_type: "application/json".into(),
            content_encoding: None,
            content_length: Some(payload.len() as u64),
            transfer_encoding: None,
            location: None,
            body: payload.clone(),
        };
        let broker = broker_with_network(
            root.path(),
            manifest.clone(),
            Arc::new(QueuedNetwork::new([Ok(response)])),
            vec![HANDLE.into()],
            vec![request_body],
            HashMap::new(),
        );
        let authority = serde_json::json!({
            "schema_version":"gate_h2_stage_program_authority_v1.0.0",
            "program_sha256":hex::encode(Sha256::digest(program)),
            "program_bytes":program.len(),
            "manifest_id":manifest.manifest_id,
            "capability_ids":[manifest.capabilities[0].capability_id],
            "input_artifact_roles":["reviewed_request_body"],
            "output_indexes":[0,1],
            "output_artifact_roles":["raw_https_response"],
            "allowed_response_statuses":[[200]]
        });
        let (listener, guard) = crate::uds::bind_owner_only(&run_root).unwrap();
        std::fs::write(run_root.join("run-token"), TOKEN).unwrap();
        std::fs::write(
            run_root.join("stage-authority.json"),
            serde_json::to_vec(&authority).unwrap(),
        )
        .unwrap();
        let server =
            std::thread::spawn(move || crate::uds::serve(listener, Arc::new(Mutex::new(broker))));
        crate::stage::run(root.path(), &run_root).unwrap_or_else(|error| panic!("{name}: {error}"));
        server.join().unwrap().unwrap();
        let retained = std::fs::read(root.path().join("outputs/raw_https_response.bin")).unwrap();
        assert_eq!(retained, payload, "{name}");
        let receipt: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.path().join("outputs/0.receipt.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            receipt["output_artifact"]["bytes"],
            payload.len() as u64,
            "{name}"
        );
        assert_eq!(
            receipt["output_artifact"]["sha256"],
            hex::encode(Sha256::digest(&payload)),
            "{name}"
        );
        drop(guard);
    }
}

#[test]
fn terminal_acceptance_is_not_released_when_sealing_fails() {
    let root = tempfile::tempdir().unwrap();
    let broker = broker(root.path());
    let manifest = broker.manifest().clone();
    let body = serde_json::to_vec(&request(&manifest)).unwrap();
    let directory = root.path().join("socket_seal_failure");
    let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
    let server = std::thread::spawn(move || {
        crate::uds::serve_with_seal_error_for_test(listener, Arc::new(Mutex::new(broker)))
    });
    let mut stream =
        std::os::unix::net::UnixStream::connect(directory.join("broker.sock")).unwrap();
    write!(
        stream,
        "POST /v1/exchange/{} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        manifest.capabilities[0].capability_id,
        body.len()
    )
    .unwrap();
    stream.write_all(&body).unwrap();
    stream.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    assert!(server.join().unwrap().is_err());
    assert!(response.is_empty());
    drop(guard);
}

#[test]
fn nonterminal_uds_delivery_failure_consumes_next_exchange_and_seals_failed_transcript() {
    assert!(crate::uds::take_delivery_error_response_for_test().is_none());
    let root = tempfile::tempdir().unwrap();
    let body = vec![b'x'; 128];
    let mut manifest = manifest(&body);
    let mut second = manifest.capabilities[0].clone();
    second.exchange_ordinal = 1;
    second.raw_response_output_role = "raw_https_response_2".into();
    second.capability_id = object_id(CAPABILITY_DOMAIN, &second, "capability_id").unwrap();
    manifest.capabilities.push(second);
    manifest.exact_exchange_count = 2;
    manifest.manifest_id = object_id(MANIFEST_DOMAIN, &manifest, "manifest_id").unwrap();
    let broker = broker_with_network(
        root.path(),
        manifest.clone(),
        Arc::new(QueuedNetwork::new([Ok(success())])),
        vec![HANDLE.into(), "h2h_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".into()],
        vec![body.clone(), body],
        HashMap::new(),
    );
    let request_body = serde_json::to_vec(&request(&manifest)).unwrap();
    let directory = root.path().join("socket_delivery_failure");
    let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
    let server = std::thread::spawn(move || {
        crate::uds::serve_with_delivery_error_for_test(listener, Arc::new(Mutex::new(broker)))
    });
    let mut stream =
        std::os::unix::net::UnixStream::connect(directory.join("broker.sock")).unwrap();
    write!(
        stream,
        "POST /v1/exchange/{} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
        manifest.capabilities[0].capability_id,
        request_body.len()
    ).unwrap();
    stream.write_all(&request_body).unwrap();
    stream.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    assert!(response.is_empty());
    assert!(server.join().unwrap().is_err());
    let undelivered = crate::uds::take_delivery_error_response_for_test().unwrap();
    assert_uds_response_schema(&undelivered);
    assert_eq!(undelivered.outcome, "accepted");
    let transcript: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("evidence/transcript.v1.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(transcript["final_outcome"], "failed_closed");
    assert_eq!(transcript["attempted_exchange_count"], 2);
    assert_eq!(transcript["completed_exchange_count"], 1);
    let event_types = transcript["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["event_type"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        event_types,
        [
            "handle_consumed",
            "dns_resolved",
            "tls_verified",
            "request_sent",
            "response_committed",
            "handle_consumed",
            "exchange_failed",
        ]
    );
    assert_eq!(
        transcript["events"][6]["evidence"]["failure_code"],
        "protocol_error"
    );
    assert!(
        root.path()
            .join("evidence/transcript.authority.v2.json")
            .is_file()
    );
    drop(guard);
}

#[test]
fn malformed_uds_attempt_seals_a_valid_failed_lifecycle() {
    let root = tempfile::tempdir().unwrap();
    let broker = broker(root.path());
    let directory = root.path().join("socket_bad");
    let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
    let server =
        std::thread::spawn(move || crate::uds::serve(listener, Arc::new(Mutex::new(broker))));
    let mut stream =
        std::os::unix::net::UnixStream::connect(directory.join("broker.sock")).unwrap();
    stream
        .write_all(b"CONNECT example HTTP/1.1\r\nhost: gate-h2\r\ncontent-length: 0\r\n\r\n")
        .unwrap();
    stream.shutdown(std::net::Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    assert!(server.join().unwrap().is_err());
    assert_uds_response_schema(&response_from_http(&response));
    let transcript: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("evidence/transcript.v1.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(transcript["final_outcome"], "failed_closed");
    assert_eq!(transcript["events"][0]["event_type"], "handle_consumed");
    assert_eq!(transcript["events"][1]["event_type"], "exchange_failed");
    drop(guard);
}

fn assert_failed_terminal_evidence(root: &std::path::Path, code: &str) {
    let transcript: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("evidence/transcript.v1.json")).unwrap())
            .unwrap();
    assert_eq!(transcript["final_outcome"], "failed_closed");
    assert_eq!(transcript["events"][1]["evidence"]["failure_code"], code);
    assert!(root.join("evidence/transcript.authority.v2.json").is_file());
}

#[test]
fn accept_deadline_without_a_stream_consumes_and_seals_failed_evidence() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("socket_deadline");
    let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
    assert!(
        crate::uds::serve_with_timeout_for_test(
            listener,
            Arc::new(Mutex::new(broker(root.path()))),
            Duration::from_millis(1),
        )
        .is_err()
    );
    assert_failed_terminal_evidence(root.path(), "deadline_exceeded");
    drop(guard);
}

#[test]
fn wrong_peer_and_peer_credential_failure_seal_before_rejection() {
    type ServeFn = fn(std::os::unix::net::UnixListener, Arc<Mutex<Broker>>) -> std::io::Result<()>;
    for (name, serve, expected) in [
        (
            "wrong",
            crate::uds::serve_with_wrong_peer_for_test as ServeFn,
            "wrong_peer",
        ),
        (
            "peer_error",
            crate::uds::serve_with_peer_error_for_test as ServeFn,
            "protocol_error",
        ),
        (
            "configure_error",
            crate::uds::serve_with_configure_error_for_test as ServeFn,
            "protocol_error",
        ),
        (
            "accept_error",
            crate::uds::serve_with_accept_error_for_test as ServeFn,
            "protocol_error",
        ),
    ] {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(format!("socket_{name}"));
        let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
        let server = std::thread::spawn({
            let state = Arc::new(Mutex::new(broker(root.path())));
            move || serve(listener, state)
        });
        let mut stream =
            std::os::unix::net::UnixStream::connect(directory.join("broker.sock")).unwrap();
        let mut response = Vec::new();
        let read_result = stream.read_to_end(&mut response);
        assert!(server.join().unwrap().is_err());
        assert_failed_terminal_evidence(root.path(), expected);
        if name == "accept_error" {
            assert!(read_result.is_err() || response.is_empty());
        } else if name != "configure_error" {
            read_result.unwrap();
            assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
            let wire_response = response_from_http(&response);
            assert_uds_response_schema(&wire_response);
            assert_eq!(
                wire_response.failure_code.as_deref(),
                Some("protocol_error")
            );
        } else {
            read_result.unwrap();
            assert!(response.is_empty());
        }
        drop(guard);
    }
}
