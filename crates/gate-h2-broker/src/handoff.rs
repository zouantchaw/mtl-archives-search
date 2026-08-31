use std::{
    collections::BTreeSet,
    fs::File,
    io::{self, Read, Seek, Write},
    mem,
    os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
    os::unix::fs::MetadataExt,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::supervisor::{
    CompletionExpectations, ExchangeMode, InheritedDescriptor, SupervisorConfig,
};

const MAX_REQUEST_BYTES: u64 = 256 * 1024;
const MAX_GRANT_BYTES: usize = 2 * 1024 * 1024;
const MAX_GRANTED_FDS: usize = 64;
const SCRATCH_FD_FLOOR: RawFd = 2048;
const MAX_TARGET_FD: RawFd = 1024;
const MAX_HANDOFF_TIMEOUT_MS: u64 = 30_000;
/// Shared with `reviewed-metrics-v2.ts`: recursively lexicographically sorted
/// UTF-8 JSON object keys, compact JSON scalars/arrays, no trailing newline.
/// The enclosing schema versions are the compatibility version for this byte
/// format; do not replace this with struct declaration-order serialization.
const SUPERVISOR_CANONICAL_JSON_ALGORITHM: &str = "gate_h2_lexicographic_utf8_json_v1";
const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AuthorityTrust {
    schema_version: String,
    principal: String,
    key_id: String,
    public_key_spki_sha256: String,
    public_key_spki_der_base64: String,
    expected_peer_uid: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HandoffRequest {
    schema_version: String,
    execution_class: String,
    admission_state: String,
    candidate_id: String,
    candidate_commit: String,
    authority_sha256: String,
    stage_id: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    stage_launch_sha256: String,
    operation_sha256: String,
    session_id: String,
    authorization_id: String,
    admission_id: String,
    enrollment_id: String,
    enrollment_sha256: String,
    supervisor_executable: serde_json::Value,
    stage_program: serde_json::Value,
    stage_runtime: serde_json::Value,
    image_manifest_digest: String,
    podman: serde_json::Value,
    mounts: Vec<serde_json::Value>,
    expected_outputs: Vec<serde_json::Value>,
    uid: u32,
    gid: u32,
    deadlines: serde_json::Value,
    exchange_mode: RequestExchangeMode,
    request_sha256: String,
}

/// The request-side HTTPS commitment is deliberately typed and retained in
/// the signed grant.  Do not replace this with a count or selected-field join:
/// every member is authority material before replay can be claimed.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum RequestExchangeMode {
    None {
        manifest: Option<serde_json::Value>,
        broker: Option<serde_json::Value>,
        stage_exchange_descriptors: Vec<serde_json::Value>,
        terminal_ack_fd: Option<i32>,
    },
    Https {
        manifest: RequestManifestPin,
        broker: RequestBrokerPin,
        stage_exchange_descriptors: Vec<RequestHttpsChannel>,
        terminal_ack_fd: i32,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RequestManifestPin {
    path: String,
    realpath: String,
    sha256: String,
    bytes: u64,
    schema_version: String,
    manifest_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RequestBrokerPin {
    executable: serde_json::Value,
    static_pin_sha256: String,
    trust_roots: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RequestHttpsChannel {
    fd: i32,
    ordinal: u32,
    capability_id: String,
    request_sha256: String,
    raw_response_role: String,
    raw_response_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct GrantDescriptor {
    fd: RawFd,
    role: String,
    sha256: String,
    bytes: u64,
    fully_sealed: bool,
}

/// Signed metadata for the sole retained directory capability. Unlike byte
/// descriptors, a directory has no content digest; its stable identity is the
/// inode/ownership/mode tuple that also appears in the canonical config.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RunRootGrantDescriptor {
    fd: RawFd,
    role: String,
    path: std::path::PathBuf,
    dev: u64,
    ino: u64,
    uid: u32,
    gid: u32,
    mode: u32,
    links: u64,
    sha256: String,
    bytes: u64,
    fully_sealed: bool,
}

impl RunRootGrantDescriptor {
    fn descriptor(&self) -> GrantDescriptor {
        GrantDescriptor {
            fd: self.fd,
            role: self.role.clone(),
            sha256: self.sha256.clone(),
            bytes: self.bytes,
            fully_sealed: self.fully_sealed,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RequestDescriptor {
    fd: RawFd,
    role: String,
    ordinal: u32,
    sha256: String,
    bytes: u64,
    fully_sealed: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CredentialDescriptor {
    fd: RawFd,
    role: String,
    credential_capability_id: String,
    sha256: String,
    bytes: u64,
    fully_sealed: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BrokerBundle {
    broker_executable: serde_json::Value,
    https_request_contract: RequestExchangeMode,
    launch_config: GrantDescriptor,
    run_token: GrantDescriptor,
    evidence_signing_key: GrantDescriptor,
    replay_journal: GrantDescriptor,
    request_bodies: Vec<RequestDescriptor>,
    credentials: Vec<CredentialDescriptor>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HandoffGrant {
    schema_version: String,
    execution_class: String,
    admission_state: String,
    request_sha256: String,
    candidate_id: String,
    candidate_commit: String,
    authority_sha256: String,
    stage_id: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    stage_launch_sha256: String,
    session_id: String,
    authorization_id: String,
    admission_id: String,
    supervisor_executable: serde_json::Value,
    supervisor_config: GrantDescriptor,
    handoff_replay_journal: GrantDescriptor,
    supervisor_report: GrantDescriptor,
    completion_expectations: GrantDescriptor,
    supervisor_expectations: GrantDescriptor,
    supervisor_run_root: RunRootGrantDescriptor,
    broker_bundle: Option<BrokerBundle>,
    grant_id: String,
    issuer_principal: String,
    key_id: String,
    issued_at_unix_ms: u64,
    not_before_unix_ms: u64,
    expires_at_unix_ms: u64,
    replay_sequence: u64,
    completion_expectations_sha256: String,
    supervisor_expectations_sha256: String,
    grant_sha256: String,
    signature_base64: String,
}

struct RetainedGrantInputs<'a> {
    descriptors: &'a [GrantDescriptor],
    config: &'a SupervisorConfig,
    config_bytes: &'a [u8],
    completion_expectations_bytes: &'a [u8],
    supervisor_expectations_bytes: &'a [u8],
    completion_expectations: &'a CompletionExpectations,
}

struct HttpsRequestContractContext<'a> {
    request: &'a HandoffRequest,
    signed: &'a RequestExchangeMode,
    signed_executable: &'a serde_json::Value,
    manifest_id: &'a str,
    capability_manifest_sha256: &'a str,
    broker: &'a crate::supervisor::BrokerLaunch,
    channels: &'a [crate::supervisor::ChannelSpec],
    terminal_ack_fd: Option<i32>,
    broker_authority: Option<&'a crate::supervisor::BrokerAuthorityCommitment>,
}

pub fn run_from_args() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os();
    let _binary = args.next();
    let request_fd = parse_fd_arg(&mut args, "--request-fd")?;
    let authorizer_fd = parse_fd_arg(&mut args, "--authorizer-fd")?;
    let liveness_fd = parse_fd_arg(&mut args, "--liveness-fd")?;
    let timeout_ms = parse_u64_arg(&mut args, "--timeout-ms")?;
    let fixed = [request_fd, authorizer_fd, liveness_fd];
    if args.next().is_some() || fixed.iter().copied().collect::<BTreeSet<_>>().len() != fixed.len()
    {
        return Err("invalid post-begin handoff arguments".into());
    }
    if timeout_ms == 0 || timeout_ms > MAX_HANDOFF_TIMEOUT_MS {
        return Err("invalid post-begin handoff timeout".into());
    }
    run(
        request_fd,
        authorizer_fd,
        liveness_fd,
        Duration::from_millis(timeout_ms),
    )
}

fn parse_fd_arg(
    args: &mut impl Iterator<Item = std::ffi::OsString>,
    expected: &str,
) -> Result<RawFd, Box<dyn std::error::Error>> {
    if args.next().as_deref() != Some(std::ffi::OsStr::new(expected)) {
        return Err(format!("expected {expected}").into());
    }
    let fd = args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or_else(|| format!("missing value for {expected}"))?
        .parse::<RawFd>()?;
    if fd < 3 {
        return Err(format!("invalid descriptor for {expected}").into());
    }
    Ok(fd)
}

fn parse_u64_arg(
    args: &mut impl Iterator<Item = std::ffi::OsString>,
    expected: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    if args.next().as_deref() != Some(std::ffi::OsStr::new(expected)) {
        return Err(format!("expected {expected}").into());
    }
    Ok(args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or_else(|| format!("missing value for {expected}"))?
        .parse()?)
}

fn run(
    request_fd: RawFd,
    authorizer_fd: RawFd,
    liveness_fd: RawFd,
    timeout: Duration,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut request_file = File::from(unsafe { OwnedFd::from_raw_fd(request_fd) });
    let request_bytes = read_bounded(&mut request_file, MAX_REQUEST_BYTES)?;
    let request_value = crate::uds::parse_strict_json(&request_bytes)?;
    require_canonical(&request_bytes, &request_value, "request")?;
    let request: HandoffRequest = serde_json::from_value(request_value)?;
    validate_request(&request)?;
    let started = Instant::now();

    // #104 owns the root. Its tracked synthetic source is intentionally
    // inactive, so this exits before a caller-controlled peer, journal, report
    // channel, or child process can be consumed.
    let enrollment = crate::enrollment::source_pinned_admission(
        &request.enrollment_id,
        &request.enrollment_sha256,
    )?;
    if enrollment.inactive {
        return Err(
            "external post-begin admission remains inactive pending native enrollment activation"
                .into(),
        );
    }
    let trust = AuthorityTrust {
        schema_version: "gate_h2_post_begin_authority_trust_v1.0.0".into(),
        principal: enrollment.verifier_principal,
        key_id: enrollment.verifier_key_id,
        public_key_spki_sha256: enrollment.verifier_spki_der_sha256,
        public_key_spki_der_base64: enrollment.verifier_spki_der_base64,
        // An active enrollment must add the enrolled kernel-peer identity;
        // no request or grant label may supply it.
        expected_peer_uid: u32::MAX,
    };
    let verifying_key = validate_authority_trust(&trust)?;
    let liveness = File::from(unsafe { OwnedFd::from_raw_fd(liveness_fd) });
    validate_liveness(&liveness)?;

    let socket = unsafe { OwnedFd::from_raw_fd(authorizer_fd) };
    validate_authorizer_socket(socket.as_raw_fd(), trust.expected_peer_uid)?;
    set_nonblocking(socket.as_raw_fd())?;
    let handshake_deadline = started
        .checked_add(timeout)
        .ok_or_else(|| io::Error::other("handoff deadline overflow"))?;
    send_packet(socket.as_raw_fd(), &request_bytes, handshake_deadline)?;
    let (grant_bytes, received) = receive_packet(socket.as_raw_fd(), handshake_deadline)?;
    let grant_value = crate::uds::parse_strict_json(&grant_bytes)?;
    require_canonical(&grant_bytes, &grant_value, "grant")?;
    let grant: HandoffGrant = serde_json::from_value(grant_value)?;
    let descriptors = grant_descriptors(&grant)?;
    if descriptors.len() != received.len() || descriptors.is_empty() {
        return Err("post-begin grant SCM_RIGHTS cardinality mismatch".into());
    }
    let mut config_file = File::from(received[0].try_clone()?);
    let config_bytes = read_bounded(&mut config_file, 2 * 1024 * 1024)?;
    let config_value = crate::uds::parse_strict_json(&config_bytes)?;
    require_canonical(&config_bytes, &config_value, "config")?;
    let config: SupervisorConfig = serde_json::from_value(config_value)?;
    let mut report_file = File::from(received[2].try_clone()?);
    read_empty_descriptor(
        &mut report_file,
        &grant.supervisor_report,
        "supervisor_report",
    )?;
    let mut completion_file = File::from(received[3].try_clone()?);
    let completion_bytes = read_descriptor_bytes(
        &mut completion_file,
        &grant.completion_expectations,
        "completion_expectations",
    )?;
    let completion_value = crate::uds::parse_strict_json(&completion_bytes)?;
    require_canonical(
        &completion_bytes,
        &completion_value,
        "completion expectations",
    )?;
    let completion_expectations: CompletionExpectations = serde_json::from_value(completion_value)?;
    let mut supervisor_expectations_file = File::from(received[4].try_clone()?);
    let supervisor_expectations_bytes = read_descriptor_bytes(
        &mut supervisor_expectations_file,
        &grant.supervisor_expectations,
        "supervisor_expectations",
    )?;
    let supervisor_expectations_value =
        crate::uds::parse_strict_json(&supervisor_expectations_bytes)?;
    require_canonical(
        &supervisor_expectations_bytes,
        &supervisor_expectations_value,
        "supervisor expectations",
    )?;
    if supervisor_expectations_bytes != config_bytes {
        return Err("retained supervisor expectations differ from exact config bytes".into());
    }
    validate_grant(
        &request,
        &grant,
        RetainedGrantInputs {
            descriptors: &descriptors,
            config: &config,
            config_bytes: &config_bytes,
            completion_expectations_bytes: &completion_bytes,
            supervisor_expectations_bytes: &supervisor_expectations_bytes,
            completion_expectations: &completion_expectations,
        },
        &trust,
        &verifying_key,
    )?;
    // This is deliberately before replay claiming and RunLease::new. Every
    // received capability is validated while it still has only its transient
    // SCM_RIGHTS identity; installing it at a target FD is not validation.
    crate::supervisor::validate(&config)?;
    validate_received_descriptor_preflight(&config, &grant, &descriptors, &received)?;
    let run_root = File::from(received[5].try_clone()?);
    let mut replay_journal = File::from(received[1].try_clone()?);
    validate_live_relay_control_target_collisions(
        &descriptors,
        &[
            request_file.as_raw_fd(),
            socket.as_raw_fd(),
            liveness.as_raw_fd(),
            config_file.as_raw_fd(),
            report_file.as_raw_fd(),
            completion_file.as_raw_fd(),
            supervisor_expectations_file.as_raw_fd(),
            run_root.as_raw_fd(),
            replay_journal.as_raw_fd(),
        ],
    )?;
    // Target installation follows the complete preflight but precedes replay
    // and RunLease creation, so later relay-owned lease descriptors cannot
    // become overwrite targets.
    drop(request_file);
    drop(socket);
    install_received_fds(received, &descriptors)?;
    claim_replay(&mut replay_journal, &grant)?;
    validate_liveness(&liveness)?;
    let lease = crate::supervisor::RunLease::new(&config, run_root, started)?;
    drop(replay_journal);
    crate::supervisor::run_authorized(
        config,
        config_file,
        hex::encode(Sha256::digest(&config_bytes)),
        lease,
        crate::supervisor::GrantAuthorizationReport {
            grant_id: grant.grant_id.clone(),
            issuer_principal: grant.issuer_principal.clone(),
            key_id: grant.key_id.clone(),
            replay_sequence: grant.replay_sequence,
            request_sha256: grant.request_sha256.clone(),
            grant_sha256: grant.grant_sha256.clone(),
            completion_expectations_sha256: grant.completion_expectations_sha256.clone(),
            supervisor_expectations_sha256: grant.supervisor_expectations_sha256.clone(),
            signed_payload_base64: base64::engine::general_purpose::STANDARD
                .encode(signed_grant_payload(&grant)?),
            signature_base64: grant.signature_base64.clone(),
            completion_expectations,
        },
        liveness,
        report_file,
    )
}

fn validate_received_descriptor_preflight(
    config: &SupervisorConfig,
    grant: &HandoffGrant,
    descriptors: &[GrantDescriptor],
    received: &[OwnedFd],
) -> Result<(), Box<dyn std::error::Error>> {
    if descriptors.len() != received.len()
        || descriptors.len() < 6
        || descriptors
            .iter()
            .map(|descriptor| descriptor.fd)
            .collect::<BTreeSet<_>>()
            .len()
            != descriptors.len()
        || received
            .iter()
            .map(AsRawFd::as_raw_fd)
            .collect::<BTreeSet<_>>()
            .len()
            != received.len()
    {
        return Err("post-begin received descriptor cardinality or target mismatch".into());
    }

    let mut identities = BTreeSet::new();
    for descriptor in &received[..5] {
        let meta = File::from(descriptor.try_clone()?).metadata()?;
        if !meta.is_file() || !identities.insert((meta.dev(), meta.ino())) {
            return Err("post-begin retained descriptor is not a unique regular file".into());
        }
    }
    let mut config_file = File::from(received[0].try_clone()?);
    let config_bytes = read_descriptor_bytes(
        &mut config_file,
        &grant.supervisor_config,
        "supervisor_config",
    )?;
    let config_value = crate::uds::parse_strict_json(&config_bytes)?;
    require_canonical(&config_bytes, &config_value, "supervisor config")?;
    let parsed_config: SupervisorConfig = serde_json::from_value(config_value)?;
    if crate::evidence::canonical_json(&serde_json::to_value(&parsed_config)?).as_bytes()
        != config_bytes
        || serde_json::to_value(&parsed_config)? != serde_json::to_value(config)?
    {
        return Err("post-begin supervisor config typed canonical bytes differ".into());
    }
    let mut journal_file = File::from(received[1].try_clone()?);
    read_descriptor_bytes(
        &mut journal_file,
        &grant.handoff_replay_journal,
        "handoff_replay_journal",
    )?;
    let mut report_file = File::from(received[2].try_clone()?);
    read_empty_descriptor(
        &mut report_file,
        &grant.supervisor_report,
        "supervisor_report",
    )?;
    let mut completion_file = File::from(received[3].try_clone()?);
    read_descriptor_bytes(
        &mut completion_file,
        &grant.completion_expectations,
        "completion_expectations",
    )?;
    let mut expectations_file = File::from(received[4].try_clone()?);
    read_descriptor_bytes(
        &mut expectations_file,
        &grant.supervisor_expectations,
        "supervisor_expectations",
    )?;
    let run_root = File::from(received[5].try_clone()?);
    crate::supervisor::validate_run_root_capability(&config.run_root, &run_root)?;

    match &config.exchange_mode {
        ExchangeMode::None { .. } if received.len() == 6 => Ok(()),
        ExchangeMode::Https { broker, .. } => {
            crate::supervisor::validate_received_inherited_descriptors(
                config,
                broker,
                &received[6..],
            )
            .map_err(Into::into)
        }
        _ => Err("post-begin unexpected inherited descriptor set".into()),
    }
}

/// No grant target may replace a still-live relay descriptor. This remains
/// separate from SCM_RIGHTS source remapping: valid inherited sources are
/// copied to scratch FDs before their targets are installed.
fn validate_live_relay_control_target_collisions(
    descriptors: &[GrantDescriptor],
    live_relay_fds: &[RawFd],
) -> Result<(), Box<dyn std::error::Error>> {
    let live = live_relay_fds.iter().copied().collect::<BTreeSet<_>>();
    if descriptors
        .iter()
        .any(|descriptor| live.contains(&descriptor.fd))
    {
        return Err("post-begin grant target aliases a live relay control descriptor".into());
    }
    Ok(())
}

fn validate_request(request: &HandoffRequest) -> Result<(), Box<dyn std::error::Error>> {
    let commitment_sha256 = unsigned_sha256(request, "request_sha256")?;
    if request.schema_version != "gate_h2_post_begin_launch_request_v1.0.0"
        || !matches!(
            request.execution_class.as_str(),
            "synthetic_test_only" | "external_authorized"
        )
        || request.admission_state != "ineligible_pending_issue_101_real_linux_evidence"
        || request.request_sha256 != commitment_sha256
        || request.attempt_id != request.d1_attempt_id
        || request.enrollment_id.is_empty()
        || !hex_exact(&request.enrollment_sha256, 64)
        || request.uid == 0
        || request.gid == 0
        || request.candidate_id.is_empty()
        || request.session_id.is_empty()
        || !hex_exact(&request.candidate_commit, 40)
        || [
            &request.authority_sha256,
            &request.d1_begin_sha256,
            &request.stage_launch_sha256,
            &request.operation_sha256,
            &request.admission_id,
            &request.authorization_id,
            &request.request_sha256,
        ]
        .iter()
        .any(|value| !hex_exact(value, 64))
    {
        return Err("invalid post-begin handoff request commitment".into());
    }
    Ok(())
}

fn validate_grant(
    request: &HandoffRequest,
    grant: &HandoffGrant,
    retained: RetainedGrantInputs<'_>,
    trust: &AuthorityTrust,
    verifying_key: &VerifyingKey,
) -> Result<(), Box<dyn std::error::Error>> {
    let RetainedGrantInputs {
        descriptors,
        config,
        config_bytes,
        completion_expectations_bytes,
        supervisor_expectations_bytes,
        completion_expectations,
    } = retained;
    if grant.schema_version != "gate_h2_post_begin_launch_grant_v1.1.0"
        || grant.grant_sha256 != grant_commitment(grant)?
        || grant.issuer_principal != trust.principal
        || grant.key_id != trust.key_id
        || !hex_exact(&grant.grant_id, 64)
        || !hex_exact(&grant.completion_expectations_sha256, 64)
        || !hex_exact(&grant.supervisor_expectations_sha256, 64)
        || grant.replay_sequence == 0
        || grant.request_sha256 != request.request_sha256
        || grant.execution_class != request.execution_class
        || grant.admission_state != request.admission_state
        || grant.candidate_id != request.candidate_id
        || grant.candidate_commit != request.candidate_commit
        || grant.authority_sha256 != request.authority_sha256
        || grant.stage_id != request.stage_id
        || grant.attempt_id != request.attempt_id
        || grant.d1_attempt_id != request.d1_attempt_id
        || grant.d1_begin_sha256 != request.d1_begin_sha256
        || grant.stage_launch_sha256 != request.stage_launch_sha256
        || grant.session_id != request.session_id
        || grant.authorization_id != request.authorization_id
        || grant.admission_id != request.admission_id
        || grant.supervisor_executable != request.supervisor_executable
        || grant.supervisor_config.role != "supervisor_config"
        || grant.handoff_replay_journal.role != "handoff_replay_journal"
        || grant.supervisor_report.role != "supervisor_report"
        || grant.completion_expectations.role != "completion_expectations"
        || grant.supervisor_expectations.role != "supervisor_expectations"
        || grant.handoff_replay_journal.bytes == 0
        || grant.supervisor_report.bytes != 0
        || grant.supervisor_config.sha256 != hex::encode(Sha256::digest(config_bytes))
        || grant.supervisor_config.bytes != config_bytes.len() as u64
        || config.candidate_commit != request.candidate_commit
        || config.execution_class != request.execution_class
        || config.admission_state != request.admission_state
        || config.candidate_id != request.candidate_id
        || config.authority_sha256 != request.authority_sha256
        || config.stage_id != request.stage_id
        || config.attempt_id != request.attempt_id
        || config.d1_attempt_id != request.d1_attempt_id
        || config.d1_begin_sha256 != request.d1_begin_sha256
        || config.launch_record_sha256 != request.stage_launch_sha256
        || config.authorization_id != request.authorization_id
        || config.admission_id != request.admission_id
        || config.session_id != request.session_id
        || config.container.uid != request.uid
        || config.container.gid != request.gid
        || descriptors.len() > MAX_GRANTED_FDS
    {
        return Err("post-begin grant does not bind the exact request and stage launch".into());
    }
    if grant.completion_expectations.sha256 != grant.completion_expectations_sha256
        || grant.supervisor_expectations.sha256 != grant.supervisor_expectations_sha256
        || grant.completion_expectations.bytes != completion_expectations_bytes.len() as u64
        || grant.supervisor_expectations.bytes != supervisor_expectations_bytes.len() as u64
        || hex::encode(Sha256::digest(completion_expectations_bytes))
            != grant.completion_expectations_sha256
        || hex::encode(Sha256::digest(supervisor_expectations_bytes))
            != grant.supervisor_expectations_sha256
    {
        return Err("signed expectation descriptor commitment mismatch".into());
    }
    completion_expectations.validate_config(config, config_bytes)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    if grant.issued_at_unix_ms > now
        || grant.not_before_unix_ms > now
        || grant.expires_at_unix_ms < now
        || grant.not_before_unix_ms > grant.expires_at_unix_ms
        || grant.issued_at_unix_ms > grant.expires_at_unix_ms
    {
        return Err("post-begin grant validity window does not contain current time".into());
    }
    let signature = base64::engine::general_purpose::STANDARD.decode(&grant.signature_base64)?;
    let signature = Signature::from_slice(&signature)?;
    verifying_key.verify(&signed_grant_payload(grant)?, &signature)?;
    let bare_pin = |pin: &serde_json::Value| {
        serde_json::json!({
            "sha256": pin.get("sha256"),
            "bytes": pin.get("bytes"),
            "version": pin.get("version"),
        })
    };
    let config_mounts = config
        .container
        .mounts
        .iter()
        .map(|mount| {
            serde_json::json!({
                "source": mount.source.path,
                "guest": mount.guest,
                "writable": mount.writable,
                "artifact_role": mount.artifact_role,
                "transition": mount.transition,
            })
        })
        .collect::<Vec<_>>();
    let config_outputs = config
        .expected_outputs
        .iter()
        .map(|output| {
            serde_json::json!({
                "artifact_role": output.artifact_role,
                "path": output.path,
            })
        })
        .collect::<Vec<_>>();
    if serde_json::to_value(&config.stage_program)? != bare_pin(&request.stage_program)
        || serde_json::to_value(&config.stage_runtime)? != bare_pin(&request.stage_runtime)
        || serde_json::to_value(&config.podman)? != request.podman
        || serde_json::to_value(&config.deadlines)? != request.deadlines
        || config.image.manifest_digest != request.image_manifest_digest
        || config_mounts != request.mounts
        || config_outputs != request.expected_outputs
        || request.expected_outputs.iter().any(|output| {
            output
                .get("path")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|path| {
                    std::path::Path::new(path)
                        .starts_with(config.run_root.path.join(&config.run_id))
                })
        })
    {
        return Err("post-begin supervisor config substituted an exact launch commitment".into());
    }
    let expected: &[InheritedDescriptor] = match &config.exchange_mode {
        ExchangeMode::None { .. } => &[],
        ExchangeMode::Https { broker, .. } => &broker.inherited_descriptors,
    };
    if expected.len() + 6 != descriptors.len() {
        return Err("post-begin grant descriptor cardinality mismatch".into());
    }
    if descriptors[0] != grant.supervisor_config
        || descriptors[1] != grant.handoff_replay_journal
        || descriptors[2] != grant.supervisor_report
        || descriptors[3] != grant.completion_expectations
        || descriptors[4] != grant.supervisor_expectations
        || descriptors[5] != grant.supervisor_run_root.descriptor()
    {
        return Err("post-begin coordinator-retained replay descriptor mismatch".into());
    }
    let mut targets = BTreeSet::new();
    if grant.supervisor_run_root.role != "supervisor_run_root"
        || grant.supervisor_run_root.fd != config.run_root.fd
        || grant.supervisor_run_root.bytes != 0
        || grant.supervisor_run_root.fully_sealed
        || grant.supervisor_run_root.sha256 != hex::encode(Sha256::digest([]))
        || grant.supervisor_run_root.path != config.run_root.path
        || grant.supervisor_run_root.dev != config.run_root.dev
        || grant.supervisor_run_root.ino != config.run_root.ino
        || grant.supervisor_run_root.uid != config.run_root.uid
        || grant.supervisor_run_root.gid != config.run_root.gid
        || grant.supervisor_run_root.mode != config.run_root.mode
        || grant.supervisor_run_root.links != config.run_root.links
    {
        return Err("post-begin retained run-root descriptor mismatch".into());
    }
    for (expected, supplied) in expected.iter().zip(&descriptors[6..]) {
        if supplied.fd < 3
            || !targets.insert(supplied.fd)
            || expected.fd != supplied.fd
            || expected.role != supplied.role
            || expected.sha256 != supplied.sha256
            || expected.bytes != supplied.bytes
            || expected.fully_sealed != supplied.fully_sealed
        {
            return Err("post-begin descriptor role, order, target, or commitment mismatch".into());
        }
    }
    match (&config.exchange_mode, &grant.broker_bundle) {
        (
            ExchangeMode::None {
                manifest,
                channels,
                broker,
            },
            None,
        ) if manifest.is_none()
            && channels.is_empty()
            && broker.is_none()
            && config.broker_authority.is_none()
            && config.terminal_ack_fd.is_none()
            && matches!(&request.exchange_mode, RequestExchangeMode::None { manifest: None, broker: None, stage_exchange_descriptors, terminal_ack_fd: None } if stage_exchange_descriptors.is_empty()) =>
            {}
        (
            ExchangeMode::Https {
                broker,
                channels,
                manifest_id,
                capability_manifest_sha256,
                ..
            },
            Some(bundle),
        ) => validate_https_request_contract(HttpsRequestContractContext {
            request,
            signed: &bundle.https_request_contract,
            signed_executable: &bundle.broker_executable,
            manifest_id,
            capability_manifest_sha256,
            broker,
            channels,
            terminal_ack_fd: config.terminal_ack_fd,
            broker_authority: config.broker_authority.as_ref(),
        })?,
        _ => {
            return Err(
                "post-begin exchange mode, manifest, broker, or descriptor authority differs"
                    .into(),
            );
        }
    }
    Ok(())
}

fn validate_https_request_contract(
    context: HttpsRequestContractContext<'_>,
) -> Result<(), Box<dyn std::error::Error>> {
    let HttpsRequestContractContext {
        request,
        signed,
        signed_executable,
        manifest_id,
        capability_manifest_sha256,
        broker,
        channels,
        terminal_ack_fd,
        broker_authority,
    } = context;
    let RequestExchangeMode::Https {
        manifest,
        broker: request_broker,
        stage_exchange_descriptors,
        terminal_ack_fd: request_ack_fd,
    } = &request.exchange_mode
    else {
        return Err("post-begin HTTPS config has non-HTTPS request contract".into());
    };
    // The signed copy provides authority for every request-only pin (including
    // static and trust pins); the config supplies the canonical runtime join.
    if validate_signed_https_contract(&request.exchange_mode, signed, signed_executable).is_err()
        || manifest.manifest_id != manifest_id
        || manifest.sha256 != capability_manifest_sha256
        || request_broker.executable.get("sha256")
            != Some(&serde_json::Value::String(broker.executable.sha256.clone()))
        || request_broker.executable.get("bytes")
            != Some(&serde_json::Value::Number(broker.executable.bytes.into()))
        || terminal_ack_fd != Some(*request_ack_fd)
        || validate_config_broker_authority(request_broker, broker_authority).is_err()
        || stage_exchange_descriptors.len() != channels.len()
    {
        return Err(
            "post-begin HTTPS request contract is not exactly signed and configured".into(),
        );
    }
    for (request_channel, configured_channel) in stage_exchange_descriptors.iter().zip(channels) {
        if request_channel.fd != configured_channel.inherited_fd
            || request_channel.ordinal != configured_channel.ordinal.unwrap_or(u32::MAX)
            || Some(request_channel.capability_id.as_str())
                != configured_channel.capability_id.as_deref()
            || Some(request_channel.request_sha256.as_str())
                != configured_channel.request_sha256.as_deref()
            || Some(request_channel.raw_response_role.as_str())
                != configured_channel.raw_response_role.as_deref()
            || Some(request_channel.raw_response_path.as_str())
                != configured_channel
                    .raw_response_path
                    .as_ref()
                    .and_then(|path| path.to_str())
        {
            return Err(
                "post-begin HTTPS channel tuple is not exactly signed and configured".into(),
            );
        }
    }
    Ok(())
}

fn validate_config_broker_authority(
    request: &RequestBrokerPin,
    config: Option<&crate::supervisor::BrokerAuthorityCommitment>,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = config.ok_or("HTTPS supervisor config omitted broker authority commitments")?;
    if config.static_pin_sha256 != request.static_pin_sha256
        || serde_json::to_value(&config.trust_roots)? != request.trust_roots
    {
        return Err(
            "HTTPS supervisor config broker static or trust pin differs from request".into(),
        );
    }
    Ok(())
}

fn validate_signed_https_contract(
    request: &RequestExchangeMode,
    signed: &RequestExchangeMode,
    signed_executable: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let RequestExchangeMode::Https { broker, .. } = request else {
        return Err("post-begin HTTPS config has non-HTTPS request contract".into());
    };
    if request != signed || &broker.executable != signed_executable {
        return Err("post-begin HTTPS request contract is not exactly signed".into());
    }
    Ok(())
}

fn unsigned_sha256(value: &impl Serialize, field: &str) -> Result<String, serde_json::Error> {
    let mut value = serde_json::to_value(value)?;
    value
        .as_object_mut()
        .expect("contract is an object")
        .remove(field);
    Ok(hex::encode(Sha256::digest(canonical_json(&value)?)))
}

fn signed_grant_payload(grant: &HandoffGrant) -> Result<Vec<u8>, serde_json::Error> {
    let mut value = serde_json::to_value(grant)?;
    value
        .as_object_mut()
        .expect("grant is an object")
        .remove("signature_base64");
    canonical_json(&value)
}

fn grant_commitment(grant: &HandoffGrant) -> Result<String, serde_json::Error> {
    let mut value = serde_json::to_value(grant)?;
    let object = value.as_object_mut().expect("grant is an object");
    object.remove("grant_sha256");
    object.remove("signature_base64");
    Ok(hex::encode(Sha256::digest(canonical_json(&value)?)))
}

fn canonical_json(value: &impl Serialize) -> Result<Vec<u8>, serde_json::Error> {
    let value = serde_json::to_value(value)?;
    Ok(crate::evidence::canonical_json(&value).into_bytes())
}

fn require_canonical(
    bytes: &[u8],
    value: &serde_json::Value,
    label: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let _algorithm = SUPERVISOR_CANONICAL_JSON_ALGORITHM;
    if bytes != canonical_json(value)? {
        return Err(format!("post-begin {label} is not canonical compact sorted JSON").into());
    }
    Ok(())
}

fn validate_authority_trust(
    trust: &AuthorityTrust,
) -> Result<VerifyingKey, Box<dyn std::error::Error>> {
    let spki =
        base64::engine::general_purpose::STANDARD.decode(&trust.public_key_spki_der_base64)?;
    if trust.schema_version != "gate_h2_post_begin_authority_trust_v1.0.0"
        || trust.principal.is_empty()
        || trust.key_id.is_empty()
        || spki.len() != ED25519_SPKI_PREFIX.len() + 32
        || spki[..ED25519_SPKI_PREFIX.len()] != ED25519_SPKI_PREFIX
        || hex::encode(Sha256::digest(&spki)) != trust.public_key_spki_sha256
    {
        return Err("invalid authority-pinned post-begin verifier".into());
    }
    let key: [u8; 32] = spki[ED25519_SPKI_PREFIX.len()..].try_into()?;
    Ok(VerifyingKey::from_bytes(&key)?)
}

fn validate_liveness(file: &File) -> io::Result<()> {
    let mut poll = libc::pollfd {
        fd: file.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    let result = unsafe { libc::poll(&mut poll, 1, 0) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    if poll.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "launcher liveness descriptor reached EOF",
        ));
    }
    Ok(())
}

fn claim_replay(file: &mut File, grant: &HandoffGrant) -> io::Result<()> {
    claim_replay_with_sync(file, grant, File::sync_all)
}

fn claim_replay_with_sync<F>(file: &mut File, grant: &HandoffGrant, sync: F) -> io::Result<()>
where
    F: FnOnce(&File) -> io::Result<()>,
{
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let bytes = read_bounded(file, 8 * 1024 * 1024)?;
        // Exact newline-delimited representation only. A crash between the
        // record bytes and the trailing LF must not leave a parseable tail.
        if !bytes.is_empty() && !bytes.ends_with(b"\n") {
            return Err(io::Error::other(
                "replay journal is missing a trailing newline",
            ));
        }
        let mut maximum = 0_u64;
        if !bytes.is_empty() {
            for line in bytes[..bytes.len() - 1].split(|byte| *byte == b'\n') {
                if line.is_empty() {
                    return Err(io::Error::other("replay journal contains a blank record"));
                }
                let value = crate::uds::parse_strict_json(line)
                    .map_err(|_| io::Error::other("replay journal contains invalid JSON"))?;
                if canonical_json(&value).map_err(io::Error::other)? != line {
                    return Err(io::Error::other(
                        "replay journal contains noncanonical record",
                    ));
                }
                let object = value
                    .as_object()
                    .ok_or_else(|| io::Error::other("replay journal record is not an object"))?;
                let sequence = object
                    .get("replay_sequence")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or_else(|| io::Error::other("replay journal sequence is absent"))?;
                maximum = maximum.max(sequence);
                if object.get("grant_id").and_then(serde_json::Value::as_str)
                    == Some(grant.grant_id.as_str())
                    || object.get("attempt_id").and_then(serde_json::Value::as_str)
                        == Some(grant.attempt_id.as_str())
                {
                    return Err(io::Error::other("duplicate grant or attempt replay"));
                }
            }
        }
        if grant.replay_sequence <= maximum {
            return Err(io::Error::other("grant replay sequence did not increase"));
        }
        let record = serde_json::json!({
            "attempt_id": grant.attempt_id,
            "grant_id": grant.grant_id,
            "replay_sequence": grant.replay_sequence,
        });
        let mut record = canonical_json(&record).map_err(io::Error::other)?;
        record.push(b'\n');
        file.seek(io::SeekFrom::End(0))?;
        file.write_all(&record)?;
        sync(file)
    })();
    let unlock = if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    };
    result.and(unlock)
}

fn grant_descriptors(
    grant: &HandoffGrant,
) -> Result<Vec<GrantDescriptor>, Box<dyn std::error::Error>> {
    if grant.supervisor_run_root.role != "supervisor_run_root"
        || grant.supervisor_run_root.fd < 3
        || grant.supervisor_run_root.path.as_os_str().is_empty()
        || grant.supervisor_run_root.dev == 0
        || grant.supervisor_run_root.ino == 0
        || grant.supervisor_run_root.links == 0
        || grant.supervisor_run_root.mode & !0o7777 != 0
        || grant.supervisor_run_root.mode & 0o022 != 0
        || grant.supervisor_run_root.sha256 != hex::encode(Sha256::digest([]))
        || grant.supervisor_run_root.bytes != 0
        || grant.supervisor_run_root.fully_sealed
    {
        return Err("post-begin retained run-root descriptor is malformed".into());
    }
    let mut descriptors = vec![
        grant.supervisor_config.clone(),
        grant.handoff_replay_journal.clone(),
        grant.supervisor_report.clone(),
        grant.completion_expectations.clone(),
        grant.supervisor_expectations.clone(),
        grant.supervisor_run_root.descriptor(),
    ];
    if let Some(bundle) = &grant.broker_bundle {
        descriptors.extend([
            bundle.launch_config.clone(),
            bundle.run_token.clone(),
            bundle.evidence_signing_key.clone(),
            bundle.replay_journal.clone(),
        ]);
        for (index, descriptor) in bundle.request_bodies.iter().enumerate() {
            if descriptor.role != "request_body" || descriptor.ordinal != index as u32 {
                return Err("post-begin request descriptors are not exact ordered ordinals".into());
            }
            descriptors.push(GrantDescriptor {
                fd: descriptor.fd,
                role: format!("request_body_{index}"),
                sha256: descriptor.sha256.clone(),
                bytes: descriptor.bytes,
                fully_sealed: descriptor.fully_sealed,
            });
        }
        for descriptor in &bundle.credentials {
            if descriptor.role != "credential"
                || !hex_exact(&descriptor.credential_capability_id, 64)
            {
                return Err("post-begin credential descriptor is malformed".into());
            }
            descriptors.push(GrantDescriptor {
                fd: descriptor.fd,
                role: format!("credential_{}", descriptor.credential_capability_id),
                sha256: descriptor.sha256.clone(),
                bytes: descriptor.bytes,
                fully_sealed: descriptor.fully_sealed,
            });
        }
    }
    let mut targets = BTreeSet::new();
    if descriptors.iter().any(|descriptor| {
        descriptor.fd < 3 || descriptor.fd > MAX_TARGET_FD || !targets.insert(descriptor.fd)
    }) {
        return Err("post-begin descriptor target is invalid or duplicated".into());
    }
    Ok(descriptors)
}

fn validate_authorizer_socket(fd: RawFd, expected_uid: u32) -> io::Result<()> {
    let mut socket_type = 0_i32;
    let mut length = mem::size_of::<i32>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_TYPE,
            (&mut socket_type as *mut i32).cast(),
            &mut length,
        )
    } < 0
        || socket_type != libc::SOCK_SEQPACKET
    {
        return Err(io::Error::other(
            "authorizer FD is not a Unix sequenced-packet socket",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        let mut credential: libc::ucred = unsafe { mem::zeroed() };
        let mut length = mem::size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut credential as *mut libc::ucred).cast(),
                &mut length,
            )
        } < 0
            || credential.pid <= 0
            || credential.uid != expected_uid
        {
            return Err(io::Error::other("authorizer SO_PEERCRED mismatch"));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let mut uid = 0_u32;
        let mut gid = 0_u32;
        if unsafe { libc::getpeereid(fd, &mut uid, &mut gid) } < 0 || uid != expected_uid {
            return Err(io::Error::other("authorizer peer credential mismatch"));
        }
    }
    Ok(())
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn poll_socket(fd: RawFd, events: i16, deadline: Instant) -> io::Result<()> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "authorizer handshake deadline expired",
            ));
        }
        let mut poll_fd = libc::pollfd {
            fd,
            events,
            revents: 0,
        };
        let timeout = i32::try_from(remaining.as_millis())
            .unwrap_or(i32::MAX)
            .max(1);
        let result = unsafe { libc::poll(&mut poll_fd, 1, timeout) };
        if result > 0 {
            if poll_fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                return Err(io::Error::other(
                    "authorizer socket failed during handshake",
                ));
            }
            return Ok(());
        }
        if result == 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "authorizer handshake deadline expired",
            ));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn send_packet(fd: RawFd, bytes: &[u8], deadline: Instant) -> io::Result<()> {
    poll_socket(fd, libc::POLLOUT, deadline)?;
    let written = unsafe { libc::send(fd, bytes.as_ptr().cast(), bytes.len(), libc::MSG_NOSIGNAL) };
    if written < 0 || written as usize != bytes.len() {
        return Err(if written < 0 {
            io::Error::last_os_error()
        } else {
            io::Error::other("partial authorizer request packet")
        });
    }
    Ok(())
}

fn receive_packet(fd: RawFd, deadline: Instant) -> io::Result<(Vec<u8>, Vec<OwnedFd>)> {
    poll_socket(fd, libc::POLLIN, deadline)?;
    let mut bytes = vec![0_u8; MAX_GRANT_BYTES + 1];
    let control_bytes =
        unsafe { libc::CMSG_SPACE((MAX_GRANTED_FDS * mem::size_of::<RawFd>()) as u32) as usize };
    let mut control = vec![0_u8; control_bytes];
    let mut iovec = libc::iovec {
        iov_base: bytes.as_mut_ptr().cast(),
        iov_len: bytes.len(),
    };
    let mut message: libc::msghdr = unsafe { mem::zeroed() };
    message.msg_iov = &mut iovec;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len() as _;
    #[cfg(target_os = "linux")]
    let receive_flags = libc::MSG_CMSG_CLOEXEC;
    #[cfg(not(target_os = "linux"))]
    let receive_flags = 0;
    let received = unsafe { libc::recvmsg(fd, &mut message, receive_flags) };
    if received <= 0 {
        return Err(if received < 0 {
            io::Error::last_os_error()
        } else {
            io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "authorizer closed without a grant",
            )
        });
    }
    if received as usize > MAX_GRANT_BYTES
        || message.msg_flags & (libc::MSG_TRUNC | libc::MSG_CTRUNC) != 0
    {
        return Err(io::Error::other(
            "authorizer grant packet exceeded a hard bound",
        ));
    }
    bytes.truncate(received as usize);
    let mut descriptors = Vec::new();
    let mut header = unsafe { libc::CMSG_FIRSTHDR(&message) };
    while !header.is_null() {
        let header_ref = unsafe { &*header };
        if header_ref.cmsg_level != libc::SOL_SOCKET || header_ref.cmsg_type != libc::SCM_RIGHTS {
            return Err(io::Error::other("unexpected authorizer ancillary message"));
        }
        let payload = header_ref.cmsg_len as usize - unsafe { libc::CMSG_LEN(0) as usize };
        if payload % mem::size_of::<RawFd>() != 0 {
            return Err(io::Error::other("malformed SCM_RIGHTS payload"));
        }
        let count = payload / mem::size_of::<RawFd>();
        let raw = unsafe { libc::CMSG_DATA(header).cast::<RawFd>() };
        for index in 0..count {
            let descriptor = unsafe { OwnedFd::from_raw_fd(*raw.add(index)) };
            let flags = unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFD) };
            if flags < 0
                || unsafe {
                    libc::fcntl(
                        descriptor.as_raw_fd(),
                        libc::F_SETFD,
                        flags | libc::FD_CLOEXEC,
                    )
                } < 0
            {
                return Err(io::Error::last_os_error());
            }
            descriptors.push(descriptor);
        }
        header = unsafe { libc::CMSG_NXTHDR(&message, header) };
    }
    if descriptors.len() > MAX_GRANTED_FDS {
        return Err(io::Error::other("too many authorizer descriptors"));
    }
    Ok((bytes, descriptors))
}

fn install_received_fds(received: Vec<OwnedFd>, descriptors: &[GrantDescriptor]) -> io::Result<()> {
    let targets = descriptors
        .iter()
        .map(|descriptor| descriptor.fd)
        .collect::<BTreeSet<_>>();
    if received.len() != descriptors.len()
        || received.len() < 6
        || targets.len() != descriptors.len()
    {
        return Err(io::Error::other(
            "received FD remap cardinality or targets are invalid",
        ));
    }
    let mut scratch = Vec::with_capacity(received.len() - 6);
    for descriptor in &received[6..] {
        let fd = unsafe {
            libc::fcntl(
                descriptor.as_raw_fd(),
                libc::F_DUPFD_CLOEXEC,
                SCRATCH_FD_FLOOR,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        scratch.push(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    // The scratch copies are independent. Releasing every transient received
    // descriptor now prevents a later OwnedFd drop from closing an installed
    // target that happened to share its numeric value.
    drop(received);
    for (source, descriptor) in scratch.iter().zip(&descriptors[6..]) {
        if unsafe { libc::dup2(source.as_raw_fd(), descriptor.fd) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let flags = unsafe { libc::fcntl(descriptor.fd, libc::F_GETFD) };
        if flags < 0
            || unsafe { libc::fcntl(descriptor.fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn read_bounded(file: &mut File, cap: u64) -> io::Result<Vec<u8>> {
    file.rewind()?;
    let mut bytes = Vec::new();
    file.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(io::Error::other("handoff request exceeded hard byte cap"));
    }
    Ok(bytes)
}

fn read_descriptor_bytes(
    file: &mut File,
    descriptor: &GrantDescriptor,
    role: &str,
) -> io::Result<Vec<u8>> {
    if descriptor.role != role || !hex_exact(&descriptor.sha256, 64) || descriptor.bytes == 0 {
        return Err(io::Error::other("invalid retained expectation descriptor"));
    }
    let bytes = read_bounded(file, MAX_GRANT_BYTES as u64)?;
    if bytes.len() as u64 != descriptor.bytes
        || hex::encode(Sha256::digest(&bytes)) != descriptor.sha256
    {
        return Err(io::Error::other(
            "retained expectation descriptor hash or size mismatch",
        ));
    }
    Ok(bytes)
}

fn read_empty_descriptor(
    file: &mut File,
    descriptor: &GrantDescriptor,
    role: &str,
) -> io::Result<()> {
    if descriptor.role != role
        || !hex_exact(&descriptor.sha256, 64)
        || descriptor.bytes != 0
        || hex::encode(Sha256::digest([])) != descriptor.sha256
        || !read_bounded(file, 0)?.is_empty()
    {
        return Err(io::Error::other("invalid retained empty report descriptor"));
    }
    Ok(())
}

fn hex_exact(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, tempfile};

    fn replay_grant(grant_id: &str, attempt_id: &str, sequence: u64) -> HandoffGrant {
        HandoffGrant {
            schema_version: "gate_h2_post_begin_launch_grant_v1.1.0".into(),
            execution_class: "external_authorized".into(),
            admission_state: "ineligible_pending_issue_101_real_linux_evidence".into(),
            request_sha256: "1".repeat(64),
            candidate_id: "candidate".into(),
            candidate_commit: "2".repeat(40),
            authority_sha256: "3".repeat(64),
            stage_id: "visual_predict".into(),
            attempt_id: attempt_id.into(),
            d1_attempt_id: attempt_id.into(),
            d1_begin_sha256: "4".repeat(64),
            stage_launch_sha256: "5".repeat(64),
            session_id: "session".into(),
            authorization_id: "6".repeat(64),
            admission_id: "7".repeat(64),
            supervisor_executable: serde_json::json!({}),
            supervisor_config: GrantDescriptor {
                fd: 3,
                role: "supervisor_config".into(),
                sha256: "8".repeat(64),
                bytes: 1,
                fully_sealed: false,
            },
            handoff_replay_journal: GrantDescriptor {
                fd: 4,
                role: "handoff_replay_journal".into(),
                sha256: "f".repeat(64),
                bytes: 1,
                fully_sealed: false,
            },
            supervisor_report: GrantDescriptor {
                fd: 5,
                role: "supervisor_report".into(),
                sha256: hex::encode(Sha256::digest([])),
                bytes: 0,
                fully_sealed: false,
            },
            completion_expectations: GrantDescriptor {
                fd: 6,
                role: "completion_expectations".into(),
                sha256: "9".repeat(64),
                bytes: 1,
                fully_sealed: false,
            },
            supervisor_expectations: GrantDescriptor {
                fd: 7,
                role: "supervisor_expectations".into(),
                sha256: "a".repeat(64),
                bytes: 1,
                fully_sealed: false,
            },
            supervisor_run_root: RunRootGrantDescriptor {
                fd: 8,
                role: "supervisor_run_root".into(),
                path: "/tmp/retained-root".into(),
                dev: 1,
                ino: 1,
                uid: 1,
                gid: 1,
                mode: 0o700,
                links: 1,
                sha256: hex::encode(Sha256::digest([])),
                bytes: 0,
                fully_sealed: false,
            },
            broker_bundle: None,
            grant_id: grant_id.into(),
            issuer_principal: "authority".into(),
            key_id: "authority-key".into(),
            issued_at_unix_ms: 1,
            not_before_unix_ms: 1,
            expires_at_unix_ms: u64::MAX,
            replay_sequence: sequence,
            completion_expectations_sha256: "9".repeat(64),
            supervisor_expectations_sha256: "a".repeat(64),
            grant_sha256: "b".repeat(64),
            signature_base64: String::new(),
        }
    }

    fn https_contract() -> RequestExchangeMode {
        RequestExchangeMode::Https {
            manifest: RequestManifestPin {
                path: "/sealed/manifest.json".into(),
                realpath: "/sealed/manifest.json".into(),
                sha256: "a".repeat(64),
                bytes: 9,
                schema_version: "gate_h2_https_exchange_manifest_v1.0.0".into(),
                manifest_id: "b".repeat(64),
            },
            broker: RequestBrokerPin {
                executable: serde_json::json!({"bytes": 10, "path": "/broker", "realpath": "/broker", "sha256": "c".repeat(64), "version": "v1"}),
                static_pin_sha256: "d".repeat(64),
                trust_roots: serde_json::json!({"bytes": 11, "path": "/roots", "realpath": "/roots", "sha256": "e".repeat(64), "version": "v1"}),
            },
            stage_exchange_descriptors: vec![RequestHttpsChannel {
                fd: 3,
                ordinal: 0,
                capability_id: "f".repeat(64),
                request_sha256: "1".repeat(64),
                raw_response_role: "raw_response_0".into(),
                raw_response_path: "/run/raw-0.json".into(),
            }],
            terminal_ack_fd: 4,
        }
    }

    #[test]
    fn signed_https_contract_rejects_every_request_pin_mutation_before_replay() {
        let request = https_contract();
        let executable = match &request {
            RequestExchangeMode::Https { broker, .. } => broker.executable.clone(),
            RequestExchangeMode::None { .. } => unreachable!(),
        };
        assert!(validate_signed_https_contract(&request, &request, &executable).is_ok());
        let mutations: [fn(&mut RequestExchangeMode); 12] = [
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https { manifest, .. } = contract {
                    manifest.path.push('x');
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https { manifest, .. } = contract {
                    manifest.realpath.push('x');
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https { manifest, .. } = contract {
                    manifest.sha256.replace_range(..1, "0");
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https { broker, .. } = contract {
                    broker.static_pin_sha256.replace_range(..1, "0");
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https { broker, .. } = contract {
                    broker.trust_roots["path"] = serde_json::json!("/other");
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0].fd = 9;
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0].ordinal = 1;
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0]
                        .capability_id
                        .replace_range(..1, "0");
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0]
                        .request_sha256
                        .replace_range(..1, "0");
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0].raw_response_role.push('x');
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    stage_exchange_descriptors,
                    ..
                } = contract
                {
                    stage_exchange_descriptors[0].raw_response_path.push('x');
                }
            },
            |contract: &mut RequestExchangeMode| {
                if let RequestExchangeMode::Https {
                    terminal_ack_fd, ..
                } = contract
                {
                    *terminal_ack_fd = 5;
                }
            },
        ];
        for mutation in mutations {
            let mut signed = request.clone();
            mutation(&mut signed);
            assert!(validate_signed_https_contract(&request, &signed, &executable).is_err());
        }
    }

    #[test]
    fn received_config_rejects_independent_static_and_trust_pin_substitution_before_replay() {
        let RequestExchangeMode::Https { broker, .. } = https_contract() else {
            unreachable!()
        };
        let trust_roots: crate::supervisor::BrokerTrustRootsPin =
            serde_json::from_value(broker.trust_roots.clone()).unwrap();
        let authority = crate::supervisor::BrokerAuthorityCommitment {
            static_pin_sha256: broker.static_pin_sha256.clone(),
            trust_roots,
        };
        assert!(validate_config_broker_authority(&broker, Some(&authority)).is_ok());
        let mut static_mutation = authority.clone();
        static_mutation.static_pin_sha256.replace_range(..1, "0");
        assert!(validate_config_broker_authority(&broker, Some(&static_mutation)).is_err());
        let mut trust_mutation = authority;
        trust_mutation.trust_roots.sha256.replace_range(..1, "0");
        assert!(validate_config_broker_authority(&broker, Some(&trust_mutation)).is_err());
    }

    #[test]
    fn replay_journal_is_durable_one_use_and_monotonic() {
        let mut journal = tempfile().unwrap();
        let first = replay_grant(&"c".repeat(64), "attempt-1", 10);
        claim_replay(&mut journal, &first).unwrap();
        assert!(claim_replay(&mut journal, &first).is_err());

        let duplicate_attempt = replay_grant(&"d".repeat(64), "attempt-1", 11);
        assert!(claim_replay(&mut journal, &duplicate_attempt).is_err());
        let rollback = replay_grant(&"e".repeat(64), "attempt-2", 9);
        assert!(claim_replay(&mut journal, &rollback).is_err());
        let next = replay_grant(&"f".repeat(64), "attempt-2", 11);
        claim_replay(&mut journal, &next).unwrap();
    }

    #[test]
    fn replay_journal_sync_failure_fails_the_claim() {
        let mut journal = tempfile().unwrap();
        let grant = replay_grant(&"c".repeat(64), "attempt-1", 1);
        let result = claim_replay_with_sync(&mut journal, &grant, |_| {
            Err(io::Error::other("injected journal fsync failure"))
        });
        assert!(result.is_err());
    }

    #[test]
    fn protocol_json_requires_strict_canonical_bytes() {
        let canonical = br#"{"a":1,"b":2}"#;
        let value = crate::uds::parse_strict_json(canonical).unwrap();
        require_canonical(canonical, &value, "test").unwrap();
        for substituted in [
            br#"{"b":2,"a":1}"#.as_slice(),
            br#"{ "a": 1, "b": 2 }"#.as_slice(),
            b"{\"a\":1,\"b\":2}\n".as_slice(),
        ] {
            let parsed = crate::uds::parse_strict_json(substituted).unwrap();
            assert!(require_canonical(substituted, &parsed, "test").is_err());
        }
        assert!(crate::uds::parse_strict_json(br#"{"a":1,"a":2}"#).is_err());
    }

    #[test]
    fn grant_rejects_missing_rights() {
        let descriptors = vec![GrantDescriptor {
            fd: 9,
            role: "launch_config".into(),
            sha256: "a".repeat(64),
            bytes: 1,
            fully_sealed: false,
        }];
        let left = File::open("/dev/null").unwrap();
        assert!(install_received_fds(Vec::new(), &descriptors).is_err());
        assert_eq!(left.metadata().unwrap().len(), 0);
    }

    #[test]
    fn replay_journal_rejects_missing_trailing_newline_and_blank_records() {
        let mut journal = tempfile().unwrap();
        let first = replay_grant(&"c".repeat(64), "attempt-1", 10);
        let record = serde_json::json!({
            "attempt_id": first.attempt_id,
            "grant_id": first.grant_id,
            "replay_sequence": first.replay_sequence,
        });
        let bytes = canonical_json(&record).unwrap();
        journal.write_all(&bytes).unwrap(); // deliberately omit trailing LF
        let grant = replay_grant(&"d".repeat(64), "attempt-2", 11);
        let before = journal.metadata().unwrap().len();
        assert!(claim_replay(&mut journal, &grant).is_err());
        assert_eq!(journal.metadata().unwrap().len(), before);

        let mut journal = tempfile().unwrap();
        claim_replay(&mut journal, &first).unwrap();
        // inject a blank record by appending an extra newline without a body
        journal
            .write_all(
                b"
",
            )
            .unwrap();
        let next = replay_grant(&"d".repeat(64), "attempt-2", 11);
        assert!(claim_replay(&mut journal, &next).is_err());
    }

    #[test]
    fn grant_descriptor_targets_reject_scratch_alias_range() {
        let mut grant = replay_grant(&"c".repeat(64), "attempt-1", 1);
        grant.supervisor_config.fd = SCRATCH_FD_FLOOR;
        assert!(grant_descriptors(&grant).is_err());
        grant = replay_grant(&"c".repeat(64), "attempt-1", 1);
        grant.supervisor_config.fd = MAX_TARGET_FD + 1;
        assert!(grant_descriptors(&grant).is_err());
        grant = replay_grant(&"c".repeat(64), "attempt-1", 1);
        grant.supervisor_config.fd = MAX_TARGET_FD;
        assert!(grant_descriptors(&grant).is_ok());
    }

    #[test]
    fn live_control_target_collisions_fail_before_replay_append_or_run_child_creation() {
        let root = tempdir().unwrap();
        let journal = tempfile().unwrap();
        let controls = [
            ("request", 71),
            ("authorizer", 72),
            ("liveness", 73),
            ("replay_journal", journal.as_raw_fd()),
        ];
        let live = controls.iter().map(|(_, fd)| *fd).collect::<Vec<_>>();

        for (role, control_fd) in controls {
            let descriptors = vec![GrantDescriptor {
                fd: control_fd,
                role: format!("inherited_{role}"),
                sha256: "a".repeat(64),
                bytes: 1,
                fully_sealed: false,
            }];
            assert!(
                validate_live_relay_control_target_collisions(&descriptors, &live).is_err(),
                "{role} control target was accepted"
            );
        }

        assert_eq!(journal.metadata().unwrap().len(), 0);
        assert!(root.path().read_dir().unwrap().next().is_none());
    }

    #[test]
    fn retained_run_root_descriptor_is_required_in_the_fixed_scm_rights_order() {
        let grant = replay_grant(&"c".repeat(64), "attempt-1", 1);
        let descriptors = grant_descriptors(&grant).unwrap();
        assert_eq!(descriptors.len(), 6);
        assert_eq!(descriptors[5], grant.supervisor_run_root.descriptor());
        assert_eq!(descriptors[5].role, "supervisor_run_root");
        assert_eq!(descriptors[5].bytes, 0);
        let mut replaced = grant;
        replaced.supervisor_run_root.role = "replay_journal".into();
        assert!(grant_descriptors(&replaced).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sequenced_packet_preserves_one_grant_and_ordered_scm_rights() {
        let mut sockets = [-1; 2];
        assert_eq!(
            unsafe {
                libc::socketpair(libc::AF_UNIX, libc::SOCK_SEQPACKET, 0, sockets.as_mut_ptr())
            },
            0
        );
        let left = unsafe { OwnedFd::from_raw_fd(sockets[0]) };
        let right = unsafe { OwnedFd::from_raw_fd(sockets[1]) };
        let first = File::open("/dev/null").unwrap();
        let second = File::open("/dev/zero").unwrap();
        send_test_rights(
            left.as_raw_fd(),
            b"{\"grant\":true}\n",
            &[first.as_raw_fd(), second.as_raw_fd()],
        )
        .unwrap();
        let (packet, received) =
            receive_packet(right.as_raw_fd(), Instant::now() + Duration::from_secs(1)).unwrap();
        assert_eq!(packet, b"{\"grant\":true}\n");
        assert_eq!(received.len(), 2);
        assert!(
            received
                .iter()
                .all(|fd| unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFD) } >= 0)
        );
    }

    #[cfg(target_os = "linux")]
    fn send_test_rights(fd: RawFd, bytes: &[u8], rights: &[RawFd]) -> io::Result<()> {
        let mut iovec = libc::iovec {
            iov_base: bytes.as_ptr().cast_mut().cast(),
            iov_len: bytes.len(),
        };
        let control_len =
            unsafe { libc::CMSG_SPACE((rights.len() * mem::size_of::<RawFd>()) as u32) as usize };
        let mut control = vec![0_u8; control_len];
        let mut message: libc::msghdr = unsafe { mem::zeroed() };
        message.msg_iov = &mut iovec;
        message.msg_iovlen = 1;
        message.msg_control = control.as_mut_ptr().cast();
        message.msg_controllen = control.len() as _;
        let header = unsafe { libc::CMSG_FIRSTHDR(&message) };
        if header.is_null() {
            return Err(io::Error::other("test SCM_RIGHTS header is absent"));
        }
        unsafe {
            (*header).cmsg_level = libc::SOL_SOCKET;
            (*header).cmsg_type = libc::SCM_RIGHTS;
            (*header).cmsg_len =
                libc::CMSG_LEN((rights.len() * mem::size_of::<RawFd>()) as u32) as _;
            std::ptr::copy_nonoverlapping(
                rights.as_ptr(),
                libc::CMSG_DATA(header).cast::<RawFd>(),
                rights.len(),
            );
        }
        let written = unsafe { libc::sendmsg(fd, &message, 0) };
        if written == bytes.len() as isize {
            Ok(())
        } else if written < 0 {
            Err(io::Error::last_os_error())
        } else {
            Err(io::Error::other("partial test packet"))
        }
    }
}
