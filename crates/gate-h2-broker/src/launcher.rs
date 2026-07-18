use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{self, Read, Seek, Write},
    os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    Broker, BrokerConfig, ProductionNetworkClient,
    credential::{MAX_SECRET_BYTES, SecretBytes},
    evidence::{
        AuthorityBindings, EvidenceWriter, SIGNING_KEY_BASE64URL_BYTES, SystemClock, canonical_json,
    },
    model::{AuthScheme, FilePin, Manifest, SchemaPin},
};

const CONFIG_DOMAIN: &[u8] = b"gate-h2-production-launch-config-v1\0";
const AUTHORIZATION_ID_DOMAIN: &[u8] = b"gate-h2-production-launch-authorization-id-v1\0";
const AUTHORIZATION_SIGNATURE_DOMAIN: &[u8] =
    b"gate-h2-production-launch-authorization-ed25519-v1\0";
const ADMITTED_CODE_ID: Option<&str> = option_env!("GATE_H2_ADMITTED_CODE_ID");
const LAUNCH_AUTHORITY_TRUST_JSON: Option<&str> =
    option_env!("GATE_H2_LAUNCH_AUTHORITY_TRUST_JSON");
const MAX_CONFIG_BYTES: usize = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_AGGREGATE_REQUEST_BYTES: u64 = 256 * 1024 * 1024;
const MAX_AGGREGATE_CREDENTIAL_BYTES: u64 = 1024 * 1024;
const MAX_AUTHORIZATION_LIFETIME_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_EXECUTABLE_BYTES: u64 = 80 * 1024 * 1024;

#[derive(Debug)]
struct ServeCleanupError {
    serve: io::Error,
    cleanup: io::Error,
}

impl std::fmt::Display for ServeCleanupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "broker serve failed: {}; broker cleanup failed: {}",
            self.serve, self.cleanup
        )
    }
}

impl std::error::Error for ServeCleanupError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.serve)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LaunchConfig {
    schema_version: String,
    admission_id: String,
    broker_code_identity_sha256: String,
    authority_state: String,
    manifest: Manifest,
    expected_uid: u32,
    session_id: String,
    attempt_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    run_token_fd: RawFd,
    run_token_sha256: String,
    signing_key_fd: RawFd,
    signing_key_sha256: String,
    signer_id: String,
    signer_trust_entry_sha256: String,
    handles: Vec<String>,
    request_body_fds: Vec<RawFd>,
    credentials: Vec<CredentialDescriptor>,
    replay_journal_fd: RawFd,
    socket_identity_sha256: String,
    socket_directory: PathBuf,
    output_directory: PathBuf,
    evidence_directory: PathBuf,
    broker_binary: FilePin,
    stage_runtime: FilePin,
    stage_runtime_path: PathBuf,
    trust_roots: FilePin,
    event_schema_pin: SchemaPin,
    transcript_schema_pin: SchemaPin,
    authority_schema_pin: SchemaPin,
    launch_authorization: LaunchAuthorization,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CredentialDescriptor {
    credential_capability_id: String,
    fd: RawFd,
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LaunchAuthorization {
    authorization_version: String,
    authorization_id: String,
    key_id: String,
    signature_algorithm: String,
    sequence: u64,
    issued_at_unix_ms: u64,
    not_before_unix_ms: u64,
    expires_at_unix_ms: u64,
    signature_base64url: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LaunchAuthorityTrust {
    trust_version: String,
    key_id: String,
    signature_algorithm: String,
    public_key_base64url: String,
    minimum_sequence: u64,
    replay_journal_dev: u64,
    replay_journal_ino: u64,
    replay_journal_owner_uid: u32,
}

pub fn run_from_args() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os();
    let _binary = args.next();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--config-fd")) {
        return Err("expected --config-fd".into());
    }
    let fd: RawFd = args
        .next()
        .and_then(|value| value.into_string().ok())
        .ok_or("missing config descriptor")?
        .parse()?;
    if args.next().is_some() || fd < 3 {
        return Err("invalid launcher arguments".into());
    }
    run_from_config_fd(fd)
}

pub fn run_from_config_fd(fd: RawFd) -> Result<(), Box<dyn std::error::Error>> {
    let config_bytes = read_inherited_fd(fd, MAX_CONFIG_BYTES)?;
    let value = crate::uds::parse_strict_json(&config_bytes)?;
    let config: LaunchConfig = serde_json::from_value(value.clone())?;
    validate_canonical_launch_config_bytes(&config_bytes, &config)?;
    let trust = embedded_launch_authority_trust()?;
    validate_admission(&config, &value, &trust, unix_time_millis()?)?;
    let _broker_executable = pin_running_executable(&config.broker_binary)?;
    let _stage_runtime_executable =
        open_pinned_executable(&config.stage_runtime_path, &config.stage_runtime)?;
    if config.manifest.capabilities.iter().any(|capability| {
        capability.broker_binary.sha256 != config.broker_binary.sha256
            || capability.broker_binary.bytes != config.broker_binary.bytes
            || capability.broker_binary.version != config.broker_binary.version
    }) {
        return Err("manifest broker binary pin mismatch".into());
    }
    claim_authorization_once(
        &trust,
        config.replay_journal_fd,
        &config.launch_authorization.authorization_id,
        config.launch_authorization.sequence,
    )?;

    let run_token =
        SecretBytes::from_sealed_inherited_fd(config.run_token_fd, &config.run_token_sha256, 43)?;
    let signing_key = SecretBytes::from_sealed_inherited_fd(
        config.signing_key_fd,
        &config.signing_key_sha256,
        SIGNING_KEY_BASE64URL_BYTES,
    )?;
    let mut credentials = HashMap::new();
    for descriptor in config.credentials {
        if credentials.contains_key(&descriptor.credential_capability_id) {
            return Err("duplicate credential capability".into());
        }
        let secret = SecretBytes::from_sealed_inherited_fd(
            descriptor.fd,
            &descriptor.sha256,
            descriptor.bytes.try_into()?,
        )?;
        credentials.insert(descriptor.credential_capability_id, secret);
    }
    let mut request_bodies = Vec::with_capacity(config.request_body_fds.len());
    for (fd, capability) in config
        .request_body_fds
        .into_iter()
        .zip(&config.manifest.capabilities)
    {
        request_bodies.push(read_inherited_fd_exact(
            fd,
            capability.request_artifact.bytes,
        )?);
    }

    let network = ProductionNetworkClient::new(&config.trust_roots)?;
    if network.trust_root_pin().sha256 != config.trust_roots.sha256
        || network.trust_root_pin().bytes != config.trust_roots.bytes
        || network.trust_root_pin().version != config.trust_roots.version
    {
        return Err("native trust root FilePin mismatch".into());
    }
    let evidence = EvidenceWriter::new(
        config.evidence_directory,
        signing_key,
        config.event_schema_pin,
        config.transcript_schema_pin,
        AuthorityBindings {
            schema_pin: config.authority_schema_pin,
            d1_attempt_id: config.d1_attempt_id,
            d1_begin_sha256: config.d1_begin_sha256,
            session_id: config.session_id.clone(),
            attempt_id: config.attempt_id.clone(),
            broker_binary: config.broker_binary,
            stage_runtime: config.stage_runtime,
            trust_roots: config.trust_roots,
            signer_id: config.signer_id,
            signer_trust_entry_sha256: config.signer_trust_entry_sha256,
        },
    )?;
    let broker = Broker::new(
        BrokerConfig {
            manifest: config.manifest,
            expected_uid: config.expected_uid,
            session_id: config.session_id,
            attempt_id: config.attempt_id,
            run_token,
            handles: config.handles,
            request_bodies,
            credentials,
            socket_identity_sha256: config.socket_identity_sha256,
            output_directory: config.output_directory,
        },
        network,
        Arc::new(SystemClock::default()),
        evidence,
    )?;
    let (listener, guard) = crate::uds::bind_owner_only(&config.socket_directory)?;
    let serve_result = crate::uds::serve(listener, Arc::new(Mutex::new(broker)));
    finish_serve(serve_result, || guard.cleanup())
}

fn finish_serve(
    serve_result: io::Result<()>,
    cleanup: impl FnOnce() -> io::Result<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let cleanup_result = cleanup();
    match (serve_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(serve), Ok(())) => Err(Box::new(serve)),
        (Ok(()), Err(cleanup)) => Err(Box::new(cleanup)),
        (Err(serve), Err(cleanup)) => Err(Box::new(ServeCleanupError { serve, cleanup })),
    }
}

fn validate_canonical_launch_config_bytes(
    bytes: &[u8],
    config: &LaunchConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    // serde's struct field order is the launch-config wire order. The accepted
    // form is compact UTF-8 JSON with no trailing newline.
    if bytes != serde_json::to_vec(config)? {
        return Err("launch config bytes are not canonical".into());
    }
    Ok(())
}

fn validate_admission(
    config: &LaunchConfig,
    value: &serde_json::Value,
    trust: &LaunchAuthorityTrust,
    now_unix_ms: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    if config.schema_version != "gate_h2_production_launch_config_v1.0.0"
        || config.authority_state != "admitted_gate_h2_broker_v1"
    {
        return Err("production authority is not admitted".into());
    }
    if compute_admission_id(value.clone())? != config.admission_id {
        return Err("launch config admission ID mismatch".into());
    }
    if config.broker_code_identity_sha256.len() != 64
        || !config
            .broker_code_identity_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || ADMITTED_CODE_ID != Some(config.broker_code_identity_sha256.as_str())
    {
        return Err("this binary was not built from the admitted reviewed code identity".into());
    }
    validate_detached_authorization(value, &config.launch_authorization, trust, now_unix_ms)?;
    validate_descriptor_shape(config)?;
    let mut fds = vec![
        config.run_token_fd,
        config.signing_key_fd,
        config.replay_journal_fd,
    ];
    fds.extend(config.request_body_fds.iter().copied());
    fds.extend(config.credentials.iter().map(|credential| credential.fd));
    let mut unique = std::collections::HashSet::new();
    if fds.iter().any(|fd| *fd < 3 || !unique.insert(*fd)) {
        return Err("inherited descriptors must be unique and nonstandard".into());
    }
    Ok(())
}

fn validate_descriptor_shape(config: &LaunchConfig) -> Result<(), Box<dyn std::error::Error>> {
    validate_descriptor_shape_parts(
        &config.manifest,
        config.handles.len(),
        config.request_body_fds.len(),
        &config.credentials,
    )
}

fn validate_descriptor_shape_parts(
    manifest: &Manifest,
    handle_count: usize,
    request_fd_count: usize,
    credentials: &[CredentialDescriptor],
) -> Result<(), Box<dyn std::error::Error>> {
    let count = manifest.capabilities.len();
    if count == 0
        || count > 16
        || manifest.exact_exchange_count != count
        || handle_count != count
        || request_fd_count != count
    {
        return Err("launch descriptor cardinality mismatch".into());
    }
    let required: BTreeSet<&str> = manifest
        .capabilities
        .iter()
        .filter(|capability| capability.auth_policy.scheme != AuthScheme::None)
        .map(|capability| capability.auth_policy.credential_capability_id.as_str())
        .collect();
    let supplied: BTreeSet<&str> = credentials
        .iter()
        .map(|descriptor| descriptor.credential_capability_id.as_str())
        .collect();
    if supplied.len() != credentials.len() || supplied != required {
        return Err("credential descriptor set mismatch".into());
    }
    let mut request_total = 0_u64;
    for capability in &manifest.capabilities {
        let bytes = capability.request_artifact.bytes;
        if bytes > MAX_REQUEST_BYTES as u64 || bytes > capability.request_byte_cap {
            return Err("request descriptor length exceeds admitted bound".into());
        }
        request_total = request_total
            .checked_add(bytes)
            .ok_or("request byte aggregate overflow")?;
    }
    if request_total > MAX_AGGREGATE_REQUEST_BYTES {
        return Err("request byte aggregate exceeds admitted bound".into());
    }
    let mut credential_total = 0_u64;
    for descriptor in credentials {
        if descriptor.bytes == 0 || descriptor.bytes > MAX_SECRET_BYTES as u64 {
            return Err("credential descriptor length exceeds admitted bound".into());
        }
        credential_total = credential_total
            .checked_add(descriptor.bytes)
            .ok_or("credential byte aggregate overflow")?;
    }
    if credential_total > MAX_AGGREGATE_CREDENTIAL_BYTES {
        return Err("credential byte aggregate exceeds admitted bound".into());
    }
    Ok(())
}

fn embedded_launch_authority_trust() -> Result<LaunchAuthorityTrust, Box<dyn std::error::Error>> {
    let bytes = LAUNCH_AUTHORITY_TRUST_JSON
        .ok_or("this binary has no independently pinned launch authority trust entry")?
        .as_bytes();
    let value = crate::uds::parse_strict_json(bytes)?;
    Ok(serde_json::from_value(value)?)
}

fn validate_detached_authorization(
    value: &serde_json::Value,
    authorization: &LaunchAuthorization,
    trust: &LaunchAuthorityTrust,
    now_unix_ms: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    if trust.trust_version != "gate_h2_launch_authority_trust_v1.0.0"
        || trust.signature_algorithm != "ed25519"
        || authorization.authorization_version != "gate_h2_launch_authorization_v1.0.0"
        || authorization.signature_algorithm != "ed25519"
        || authorization.key_id != trust.key_id
        || authorization.sequence < trust.minimum_sequence
        || authorization.not_before_unix_ms > authorization.issued_at_unix_ms
        || authorization.issued_at_unix_ms > authorization.expires_at_unix_ms
        || authorization
            .expires_at_unix_ms
            .saturating_sub(authorization.not_before_unix_ms)
            > MAX_AUTHORIZATION_LIFETIME_MS
        || now_unix_ms < authorization.not_before_unix_ms
        || now_unix_ms < authorization.issued_at_unix_ms
        || now_unix_ms > authorization.expires_at_unix_ms
    {
        return Err("launch authorization is untrusted, rolled back, or stale".into());
    }
    let public_key_bytes = decode_canonical_base64url(&trust.public_key_base64url, 32)?;
    let derived_key_id = hex::encode(Sha256::digest(
        [
            b"gate-h2-launch-authority-key-ed25519-v1\0".as_slice(),
            public_key_bytes.as_slice(),
        ]
        .concat(),
    ));
    if trust.key_id != derived_key_id {
        return Err("launch authority key identity mismatch".into());
    }
    let expected_id = authorization_id(value.clone())?;
    if authorization.authorization_id != expected_id {
        return Err("launch authorization ID mismatch".into());
    }
    let signature_bytes = decode_canonical_base64url(&authorization.signature_base64url, 64)?;
    let public_key = VerifyingKey::from_bytes(public_key_bytes.as_slice().try_into()?)?;
    let signature = Signature::from_slice(&signature_bytes)?;
    let message = authorization_signature_message(value.clone())?;
    public_key.verify(&message, &signature)?;
    Ok(())
}

fn authorization_id(mut value: serde_json::Value) -> Result<String, Box<dyn std::error::Error>> {
    let authorization = value
        .as_object_mut()
        .and_then(|object| object.get_mut("launch_authorization"))
        .and_then(serde_json::Value::as_object_mut)
        .ok_or("launch authorization object required")?;
    authorization.remove("authorization_id");
    authorization.remove("signature_base64url");
    let mut hash = Sha256::new();
    hash.update(AUTHORIZATION_ID_DOMAIN);
    hash.update(canonical_json(&value));
    Ok(hex::encode(hash.finalize()))
}

fn authorization_signature_message(
    mut value: serde_json::Value,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    value
        .as_object_mut()
        .and_then(|object| object.get_mut("launch_authorization"))
        .and_then(serde_json::Value::as_object_mut)
        .ok_or("launch authorization object required")?
        .remove("signature_base64url");
    Ok([
        AUTHORIZATION_SIGNATURE_DOMAIN,
        canonical_json(&value).as_bytes(),
    ]
    .concat())
}

fn decode_canonical_base64url(
    value: &str,
    expected: usize,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let decoded = URL_SAFE_NO_PAD.decode(value)?;
    if decoded.len() != expected || URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err("noncanonical launch authority encoding".into());
    }
    Ok(decoded)
}

fn claim_authorization_once(
    trust: &LaunchAuthorityTrust,
    journal_fd: RawFd,
    authorization_id: &str,
    sequence: u64,
) -> io::Result<()> {
    claim_authorization_once_with_fault(trust, journal_fd, authorization_id, sequence, None)
}

fn claim_authorization_once_with_fault(
    trust: &LaunchAuthorityTrust,
    journal_fd: RawFd,
    authorization_id: &str,
    sequence: u64,
    fault_after: Option<&str>,
) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    if journal_fd < 3
        || authorization_id.len() != 64
        || !authorization_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe launch replay journal authority",
        ));
    }
    let flags = unsafe { libc::fcntl(journal_fd, libc::F_GETFL) };
    if flags < 0 || flags & libc::O_ACCMODE != libc::O_RDWR || flags & libc::O_APPEND == 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "journal FD must be read-write append-only",
        ));
    }
    let owned = unsafe { OwnedFd::from_raw_fd(journal_fd) };
    let mut journal = File::from(owned);
    let metadata = journal.metadata()?;
    if !metadata.is_file()
        || metadata.dev() != trust.replay_journal_dev
        || metadata.ino() != trust.replay_journal_ino
        || metadata.uid() != trust.replay_journal_owner_uid
        || (!cfg!(test) && metadata.uid() == unsafe { libc::geteuid() })
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "journal FD identity is not the privileged trust-pinned object",
        ));
    }
    if unsafe { libc::flock(journal.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let mut bytes = Vec::new();
    journal.rewind()?;
    Read::by_ref(&mut journal)
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 16 * 1024 * 1024 || (!bytes.is_empty() && !bytes.ends_with(b"\n")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "malformed or oversized launch replay journal",
        ));
    }
    let mut highest = None;
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let text = std::str::from_utf8(line).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid launch journal record")
        })?;
        let mut fields = text.split(' ');
        if fields.next() != Some("gate-h2-launch-consumed-v3") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid launch journal record",
            ));
        }
        let sequence_text = fields.next().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid launch journal record")
        })?;
        let id = fields.next().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid launch journal record")
        })?;
        if sequence_text.len() != 20
            || !sequence_text.bytes().all(|byte| byte.is_ascii_digit())
            || id.len() != 64
            || !id.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid launch replay journal entry",
            ));
        }
        let consumed = sequence_text.parse::<u64>().map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid launch replay sequence")
        })?;
        if fields.next().is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid launch journal record",
            ));
        }
        highest = Some(highest.map_or(consumed, |value: u64| value.max(consumed)));
        if id == authorization_id || sequence <= consumed {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "launch authorization is replayed or rolled back",
            ));
        }
    }
    if highest.is_some_and(|value| sequence <= value) {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "launch authorization sequence is replayed or rolled back",
        ));
    }

    if fault_after == Some("create") {
        return Err(io::Error::other("injected fault after journal create"));
    }
    journal.seek(io::SeekFrom::End(0))?;
    writeln!(
        journal,
        "gate-h2-launch-consumed-v3 {sequence:020} {authorization_id}"
    )?;
    if fault_after == Some("write") {
        return Err(io::Error::other("injected fault after journal write"));
    }
    journal.sync_all()?;
    if fault_after == Some("file-fsync") {
        return Err(io::Error::other("injected fault after journal file fsync"));
    }
    Ok(())
}

fn read_inherited_fd_exact(fd: RawFd, expected: u64) -> io::Result<Vec<u8>> {
    if expected > MAX_REQUEST_BYTES as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "descriptor bound exceeds cap",
        ));
    }
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let file = File::from(owned);
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "descriptor signed length mismatch",
        ));
    }
    let expected_usize: usize = expected
        .try_into()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "descriptor length overflow"))?;
    let mut bytes = Vec::with_capacity(expected_usize);
    file.take(expected.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() != expected_usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "descriptor exact read mismatch",
        ));
    }
    Ok(bytes)
}

fn unix_time_millis() -> Result<u64, std::time::SystemTimeError> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX))
}

fn compute_admission_id(
    mut value: serde_json::Value,
) -> Result<String, Box<dyn std::error::Error>> {
    let object = value
        .as_object_mut()
        .ok_or("launch config must be an object")?;
    object.remove("admission_id");
    object.remove("launch_authorization");
    let mut hash = Sha256::new();
    hash.update(CONFIG_DOMAIN);
    hash.update(canonical_json(&value));
    Ok(hex::encode(hash.finalize()))
}

fn read_inherited_fd(fd: RawFd, cap: usize) -> io::Result<Vec<u8>> {
    if fd < 3 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid inherited descriptor",
        ));
    }
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let mut file = File::from(owned);
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() > cap as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid inherited file",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take((cap + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > cap {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "inherited file exceeds cap",
        ));
    }
    Ok(bytes)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExecutableIdentity {
    dev: u64,
    ino: u64,
    uid: u32,
    mode: u32,
    nlink: u64,
    size: u64,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
}

struct PinnedExecutable {
    _file: File,
    _identity: ExecutableIdentity,
}

fn executable_identity(metadata: &std::fs::Metadata) -> ExecutableIdentity {
    use std::os::unix::fs::MetadataExt;
    ExecutableIdentity {
        dev: metadata.dev(),
        ino: metadata.ino(),
        uid: metadata.uid(),
        mode: metadata.mode(),
        nlink: metadata.nlink(),
        size: metadata.size(),
        mtime: metadata.mtime(),
        mtime_nsec: metadata.mtime_nsec(),
        ctime: metadata.ctime(),
        ctime_nsec: metadata.ctime_nsec(),
    }
}

fn validate_retained_executable(file: File, pin: &FilePin) -> io::Result<PinnedExecutable> {
    use std::os::unix::fs::FileExt;
    let before_metadata = file.metadata()?;
    let before = executable_identity(&before_metadata);
    if !before_metadata.file_type().is_file()
        || before.uid != unsafe { libc::geteuid() }
        || before.nlink != 1
        || before.mode & 0o7777 != 0o555
        || before.size == 0
        || before.size > MAX_EXECUTABLE_BYTES
        || before.size != pin.bytes
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "executable owner/type/link/mode/size rejected",
        ));
    }
    let mut hash = Sha256::new();
    let mut offset = 0_u64;
    let mut chunk = [0_u8; 64 * 1024];
    while offset < before.size {
        let bounded = usize::try_from((before.size - offset).min(chunk.len() as u64)).unwrap();
        let count = file.read_at(&mut chunk[..bounded], offset)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "executable changed or ended during digest",
            ));
        }
        hash.update(&chunk[..count]);
        offset += count as u64;
    }
    if file.read_at(&mut chunk[..1], offset)? != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "executable grew during digest",
        ));
    }
    if hex::encode(hash.finalize()) != pin.sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "executable digest mismatch",
        ));
    }
    let after = executable_identity(&file.metadata()?);
    if before != after {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "executable identity changed during validation",
        ));
    }
    Ok(PinnedExecutable {
        _file: file,
        _identity: before,
    })
}

fn open_pinned_executable(path: &Path, pin: &FilePin) -> io::Result<PinnedExecutable> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = std::fs::OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    validate_retained_executable(options.open(path)?, pin)
}

#[cfg(target_os = "linux")]
fn pin_running_executable(pin: &FilePin) -> io::Result<PinnedExecutable> {
    // procfs resolves this kernel-owned magic link to the inode already executing;
    // unlike current_exe(), it cannot be rebound through the original pathname.
    validate_retained_executable(File::open("/proc/self/exe")?, pin)
}

#[cfg(not(target_os = "linux"))]
fn pin_running_executable(_pin: &FilePin) -> io::Result<PinnedExecutable> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "production executable pinning requires Linux procfs",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::os::{
        fd::IntoRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt, symlink},
    };

    fn executable_fixture(path: &Path, bytes: &[u8]) -> FilePin {
        std::fs::write(path, bytes).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o555)).unwrap();
        FilePin {
            sha256: hex::encode(Sha256::digest(bytes)),
            bytes: bytes.len() as u64,
            version: "executable-fixture-v1".into(),
        }
    }

    fn journal_path(root: &Path) -> PathBuf {
        root.join("privileged-launch.journal")
    }

    fn open_journal_fd(root: &Path) -> RawFd {
        std::fs::OpenOptions::new()
            .read(true)
            .append(true)
            .open(journal_path(root))
            .unwrap()
            .into_raw_fd()
    }

    fn authorized_value(root: &Path, seed: [u8; 32]) -> (serde_json::Value, LaunchAuthorityTrust) {
        let path = journal_path(root);
        if !path.exists() {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .unwrap();
        }
        let journal = std::fs::metadata(&path).unwrap();
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key().to_bytes();
        let key_id = hex::encode(Sha256::digest(
            [
                b"gate-h2-launch-authority-key-ed25519-v1\0".as_slice(),
                public_key.as_slice(),
            ]
            .concat(),
        ));
        let trust = LaunchAuthorityTrust {
            trust_version: "gate_h2_launch_authority_trust_v1.0.0".into(),
            key_id: key_id.clone(),
            signature_algorithm: "ed25519".into(),
            public_key_base64url: URL_SAFE_NO_PAD.encode(public_key),
            minimum_sequence: 7,
            replay_journal_dev: journal.dev(),
            replay_journal_ino: journal.ino(),
            replay_journal_owner_uid: journal.uid(),
        };
        let mut value = serde_json::json!({
            "schema_version":"gate_h2_production_launch_config_v1.0.0",
            "admission_id":"a".repeat(64),
            "broker_binary":{"sha256":"b".repeat(64),"bytes":123,"version":"broker-v1"},
            "manifest":{"manifest_id":"c".repeat(64)},
            "launch_authorization":{
                "authorization_version":"gate_h2_launch_authorization_v1.0.0",
                "authorization_id":"",
                "key_id":key_id,
                "signature_algorithm":"ed25519",
                "sequence":7,
                "issued_at_unix_ms":1_000_000,
                "not_before_unix_ms":999_000,
                "expires_at_unix_ms":1_001_000,
                "signature_base64url":""
            }
        });
        let id = authorization_id(value.clone()).unwrap();
        value["launch_authorization"]["authorization_id"] = id.into();
        let message = authorization_signature_message(value.clone()).unwrap();
        value["launch_authorization"]["signature_base64url"] = URL_SAFE_NO_PAD
            .encode(signing_key.sign(&message).to_bytes())
            .into();
        (value, trust)
    }

    fn authorization(value: &serde_json::Value) -> LaunchAuthorization {
        serde_json::from_value(value["launch_authorization"].clone()).unwrap()
    }

    fn canonical_launch_fixture(
        root: &Path,
        seed: [u8; 32],
    ) -> (LaunchConfig, LaunchAuthorityTrust) {
        let (_, trust) = authorized_value(root, seed);
        let signing_key = SigningKey::from_bytes(&seed);
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../../docs/dataset-factory/fixtures/https-exchange-contract-v1/manifest-v1.json"
        ))
        .unwrap();
        let pin = FilePin {
            sha256: "b".repeat(64),
            bytes: 123,
            version: "fixture-v1".into(),
        };
        let schema_pin = SchemaPin {
            sha256: "c".repeat(64),
            bytes: 456,
            schema_version: "fixture-schema-v1".into(),
        };
        let mut config = LaunchConfig {
            schema_version: "gate_h2_production_launch_config_v1.0.0".into(),
            admission_id: String::new(),
            broker_code_identity_sha256: "a".repeat(64),
            authority_state: "admitted_gate_h2_broker_v1".into(),
            manifest,
            expected_uid: unsafe { libc::geteuid() },
            session_id: "session/id".into(),
            attempt_id: "attempt-1".into(),
            d1_attempt_id: "d1-attempt-1".into(),
            d1_begin_sha256: "d".repeat(64),
            run_token_fd: 10,
            run_token_sha256: "e".repeat(64),
            signing_key_fd: 11,
            signing_key_sha256: "f".repeat(64),
            signer_id: "1".repeat(64),
            signer_trust_entry_sha256: "2".repeat(64),
            handles: vec!["handle-1".into()],
            request_body_fds: vec![12],
            credentials: Vec::new(),
            replay_journal_fd: 13,
            socket_identity_sha256: "3".repeat(64),
            socket_directory: root.join("socket"),
            output_directory: root.join("output"),
            evidence_directory: root.join("evidence"),
            broker_binary: pin.clone(),
            stage_runtime: pin.clone(),
            stage_runtime_path: root.join("stage-runtime"),
            trust_roots: pin,
            event_schema_pin: schema_pin.clone(),
            transcript_schema_pin: schema_pin.clone(),
            authority_schema_pin: schema_pin,
            launch_authorization: LaunchAuthorization {
                authorization_version: "gate_h2_launch_authorization_v1.0.0".into(),
                authorization_id: String::new(),
                key_id: trust.key_id.clone(),
                signature_algorithm: "ed25519".into(),
                sequence: 7,
                issued_at_unix_ms: 1_000_000,
                not_before_unix_ms: 999_000,
                expires_at_unix_ms: 1_001_000,
                signature_base64url: String::new(),
            },
        };
        let mut value = serde_json::to_value(&config).unwrap();
        config.admission_id = compute_admission_id(value.clone()).unwrap();
        value = serde_json::to_value(&config).unwrap();
        config.launch_authorization.authorization_id = authorization_id(value).unwrap();
        value = serde_json::to_value(&config).unwrap();
        let message = authorization_signature_message(value).unwrap();
        config.launch_authorization.signature_base64url =
            URL_SAFE_NO_PAD.encode(signing_key.sign(&message).to_bytes());
        (config, trust)
    }

    fn reorder_first_two_fields(bytes: &[u8], object_prefix: &[u8]) -> Vec<u8> {
        let start = bytes
            .windows(object_prefix.len())
            .position(|window| window == object_prefix)
            .unwrap()
            + object_prefix.len();
        let first_end = start
            + bytes[start..]
                .iter()
                .position(|byte| *byte == b',')
                .unwrap();
        let second_end = first_end
            + 1
            + bytes[first_end + 1..]
                .iter()
                .position(|byte| *byte == b',')
                .unwrap();
        [
            &bytes[..start],
            &bytes[first_end + 1..second_end],
            b",",
            &bytes[start..first_end],
            &bytes[second_end..],
        ]
        .concat()
    }

    fn replace_once(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        let start = bytes
            .windows(from.len())
            .position(|window| window == from)
            .unwrap();
        [&bytes[..start], to, &bytes[start + from.len()..]].concat()
    }

    #[test]
    fn launch_config_requires_exact_struct_serialization_before_authority_checks() {
        let replay = tempfile::tempdir().unwrap();
        let (config, trust) = canonical_launch_fixture(replay.path(), [31; 32]);
        let canonical = serde_json::to_vec(&config).unwrap();
        validate_canonical_launch_config_bytes(&canonical, &config).unwrap();

        let mut whitespace = canonical.clone();
        whitespace.insert(1, b' ');
        let top_level_reordered = reorder_first_two_fields(&canonical, b"{");
        let nested_reordered = reorder_first_two_fields(&canonical, b"\"broker_binary\":{");
        let equivalent_escape = replace_once(
            &canonical,
            br#""session_id":"session/id""#,
            br#""session_id":"session\u002fid""#,
        );

        for (case, bytes) in [
            ("legal whitespace", whitespace),
            ("top-level field reorder", top_level_reordered),
            ("nested field reorder", nested_reordered),
            ("equivalent JSON escape", equivalent_escape),
        ] {
            let value = crate::uds::parse_strict_json(&bytes).unwrap();
            let parsed: LaunchConfig = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(
                compute_admission_id(value.clone()).unwrap(),
                parsed.admission_id
            );
            validate_detached_authorization(
                &value,
                &parsed.launch_authorization,
                &trust,
                1_000_000,
            )
            .unwrap();
            let error = validate_canonical_launch_config_bytes(&bytes, &parsed).unwrap_err();
            assert_eq!(
                error.to_string(),
                "launch config bytes are not canonical",
                "{case}"
            );
        }
    }

    #[test]
    fn launch_admission_id_binds_exact_config_bytes_without_binary_fixed_point() {
        let first = serde_json::json!({
            "admission_id": "ignored",
            "broker_code_identity_sha256": "a".repeat(64),
            "broker_binary": {"sha256":"b".repeat(64),"bytes":123,"version":"broker-v1"},
            "authority_state": "admitted_gate_h2_broker_v1",
            "schema_version": "gate_h2_production_launch_config_v1.0.0"
        });
        let mut second = first.clone();
        second["authority_state"] = serde_json::json!("changed");
        assert_ne!(
            compute_admission_id(first.clone()).unwrap(),
            compute_admission_id(second).unwrap()
        );
        let mut third = first.clone();
        third["broker_binary"]["sha256"] = serde_json::json!("c".repeat(64));
        assert_ne!(
            compute_admission_id(first).unwrap(),
            compute_admission_id(third).unwrap()
        );
    }

    #[test]
    fn executable_pin_rejects_symlinks_and_retains_identity_across_path_replacement() {
        use std::os::unix::fs::FileExt;
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("runtime");
        let pin = executable_fixture(&path, b"measured executable bytes\n");
        let link = root.path().join("runtime-link");
        symlink(&path, &link).unwrap();
        assert!(open_pinned_executable(&link, &pin).is_err());

        let retained = open_pinned_executable(&path, &pin).unwrap();
        let moved = root.path().join("runtime.original");
        std::fs::rename(&path, &moved).unwrap();
        executable_fixture(&path, b"replacement executable bytes\n");
        assert_ne!(
            executable_identity(&std::fs::metadata(&path).unwrap()),
            retained._identity
        );
        let mut bytes = vec![0; pin.bytes as usize];
        retained._file.read_exact_at(&mut bytes, 0).unwrap();
        assert_eq!(hex::encode(Sha256::digest(bytes)), pin.sha256);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn retained_executable_execution_survives_path_replacement() {
        use std::process::{Command, Stdio};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("test-runtime");
        std::fs::copy(std::env::current_exe().unwrap(), &path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o555)).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let pin = FilePin {
            sha256: hex::encode(Sha256::digest(&bytes)),
            bytes: bytes.len() as u64,
            version: "test-runtime-v1".into(),
        };
        let retained = open_pinned_executable(&path, &pin).unwrap();
        std::fs::rename(&path, root.path().join("test-runtime.original")).unwrap();
        executable_fixture(&path, b"not the retained ELF\n");
        let fd = retained._file.as_raw_fd();
        assert_eq!(unsafe { libc::fcntl(fd, libc::F_SETFD, 0) }, 0);
        let status = Command::new(format!("/proc/self/fd/{fd}"))
            .arg("--list")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn ordinary_build_has_no_production_authority() {
        assert!(ADMITTED_CODE_ID.is_none());
        assert!(LAUNCH_AUTHORITY_TRUST_JSON.is_none());
    }

    #[test]
    fn detached_authority_accepts_exact_config_and_rejects_tamper_wrong_key_unsigned_and_stale() {
        let replay = tempfile::tempdir().unwrap();
        let (value, trust) = authorized_value(replay.path(), [9; 32]);
        assert!(
            validate_detached_authorization(&value, &authorization(&value), &trust, 1_000_000)
                .is_ok()
        );

        let mut tampered = value.clone();
        tampered["broker_binary"]["sha256"] = "d".repeat(64).into();
        assert!(
            validate_detached_authorization(
                &tampered,
                &authorization(&tampered),
                &trust,
                1_000_000
            )
            .is_err()
        );

        let (_, wrong_trust) = authorized_value(replay.path(), [10; 32]);
        assert!(
            validate_detached_authorization(
                &value,
                &authorization(&value),
                &wrong_trust,
                1_000_000
            )
            .is_err()
        );

        let mut unsigned = value.clone();
        unsigned["launch_authorization"]["signature_base64url"] = "".into();
        assert!(
            validate_detached_authorization(
                &unsigned,
                &authorization(&unsigned),
                &trust,
                1_000_000
            )
            .is_err()
        );
        assert!(
            validate_detached_authorization(&value, &authorization(&value), &trust, 1_001_001)
                .is_err()
        );

        let mut rolled_back_trust = trust;
        rolled_back_trust.minimum_sequence = 8;
        assert!(
            validate_detached_authorization(
                &value,
                &authorization(&value),
                &rolled_back_trust,
                1_000_000
            )
            .is_err()
        );
    }

    #[test]
    fn detached_authorization_replay_marker_is_durable_and_one_use() {
        use std::os::unix::fs::PermissionsExt;
        let replay = tempfile::tempdir().unwrap();
        std::fs::set_permissions(replay.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let (value, trust) = authorized_value(replay.path(), [11; 32]);
        let id = authorization(&value).authorization_id;
        claim_authorization_once(&trust, open_journal_fd(replay.path()), &id, 7).unwrap();
        assert!(claim_authorization_once(&trust, open_journal_fd(replay.path()), &id, 7).is_err());
        assert!(
            claim_authorization_once(&trust, open_journal_fd(replay.path()), &"f".repeat(64), 6)
                .is_err()
        );
        claim_authorization_once(&trust, open_journal_fd(replay.path()), &"e".repeat(64), 8)
            .unwrap();
    }

    #[test]
    fn authorization_journal_requires_exact_private_mode() {
        for mode in [0o620, 0o602, 0o4600, 0o2600, 0o1600] {
            let replay = tempfile::tempdir().unwrap();
            let (_, trust) = authorized_value(replay.path(), [16; 32]);
            std::fs::set_permissions(
                journal_path(replay.path()),
                std::fs::Permissions::from_mode(mode),
            )
            .unwrap();
            assert_eq!(
                std::fs::metadata(journal_path(replay.path()))
                    .unwrap()
                    .mode()
                    & 0o7777,
                mode
            );
            assert!(
                claim_authorization_once(
                    &trust,
                    open_journal_fd(replay.path()),
                    &format!("{mode:064x}"),
                    7,
                )
                .is_err(),
                "journal mode {mode:o} was accepted"
            );
        }

        let replay = tempfile::tempdir().unwrap();
        let (_, trust) = authorized_value(replay.path(), [17; 32]);
        claim_authorization_once(&trust, open_journal_fd(replay.path()), &"a".repeat(64), 7)
            .unwrap();
    }

    #[test]
    fn authorization_journal_faults_are_fail_sticky_for_id_and_high_water() {
        use std::os::unix::fs::PermissionsExt;
        for fault in ["write", "file-fsync"] {
            let replay = tempfile::tempdir().unwrap();
            std::fs::set_permissions(replay.path(), std::fs::Permissions::from_mode(0o700))
                .unwrap();
            let (_, trust) = authorized_value(replay.path(), [12; 32]);
            let id = "a".repeat(64);
            assert!(
                claim_authorization_once_with_fault(
                    &trust,
                    open_journal_fd(replay.path()),
                    &id,
                    17,
                    Some(fault)
                )
                .is_err()
            );
            assert!(
                claim_authorization_once(&trust, open_journal_fd(replay.path()), &id, 17).is_err(),
                "fault={fault}"
            );
            for sequence in [0, 1, 16, 17] {
                assert!(
                    claim_authorization_once(
                        &trust,
                        open_journal_fd(replay.path()),
                        &format!("{sequence:064x}"),
                        sequence
                    )
                    .is_err(),
                    "fault={fault} sequence={sequence}"
                );
            }
            claim_authorization_once(&trust, open_journal_fd(replay.path()), &"b".repeat(64), 18)
                .unwrap();
        }
    }

    #[test]
    fn authorization_journal_serializes_concurrent_claims() {
        use std::{os::unix::fs::PermissionsExt, sync::Arc};
        let replay = tempfile::tempdir().unwrap();
        std::fs::set_permissions(replay.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let (_, trust) = authorized_value(replay.path(), [13; 32]);
        let trust = Arc::new(trust);
        let root = Arc::new(replay.path().to_path_buf());
        let handles: Vec<_> = (0..8)
            .map(|index| {
                let trust = Arc::clone(&trust);
                let root = Arc::clone(&root);
                std::thread::spawn(move || {
                    claim_authorization_once(
                        &trust,
                        open_journal_fd(&root),
                        &format!("{index:064x}"),
                        23,
                    )
                })
            })
            .collect();
        let accepted = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert_eq!(accepted, 1);
        assert!(
            claim_authorization_once(&trust, open_journal_fd(replay.path()), &"f".repeat(64), 23)
                .is_err()
        );
        claim_authorization_once(&trust, open_journal_fd(replay.path()), &"e".repeat(64), 24)
            .unwrap();
    }

    #[test]
    fn authorization_journal_fails_closed_on_stale_or_unsafe_entries() {
        use std::os::unix::fs::PermissionsExt;
        let replay = tempfile::tempdir().unwrap();
        std::fs::set_permissions(replay.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let (_, trust) = authorized_value(replay.path(), [14; 32]);
        std::fs::write(journal_path(replay.path()), b"malformed\n").unwrap();
        assert!(
            claim_authorization_once(&trust, open_journal_fd(replay.path()), &"a".repeat(64), 99)
                .is_err()
        );
    }

    #[test]
    fn authorization_journal_path_replacement_cannot_fork_trusted_identity() {
        let replay = tempfile::tempdir().unwrap();
        let (_, trust) = authorized_value(replay.path(), [15; 32]);
        let retained = open_journal_fd(replay.path());
        let moved = replay.path().join("moved-journal");
        std::fs::rename(journal_path(replay.path()), &moved).unwrap();
        std::fs::write(journal_path(replay.path()), b"").unwrap();
        assert!(
            claim_authorization_once(&trust, open_journal_fd(replay.path()), &"a".repeat(64), 30)
                .is_err()
        );
        claim_authorization_once(&trust, retained, &"a".repeat(64), 30).unwrap();
    }

    #[test]
    fn descriptor_cardinality_and_credential_set_fail_before_reads() {
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../../docs/dataset-factory/fixtures/https-exchange-contract-v1/manifest-v1.json"
        ))
        .unwrap();
        let required_id = manifest.capabilities[0]
            .auth_policy
            .credential_capability_id
            .clone();
        let credential = || CredentialDescriptor {
            credential_capability_id: required_id.clone(),
            fd: 8,
            sha256: "a".repeat(64),
            bytes: 32,
        };
        let required = if manifest.capabilities[0].auth_policy.scheme == AuthScheme::None {
            vec![]
        } else {
            vec![credential()]
        };
        assert!(validate_descriptor_shape_parts(&manifest, 1, 1, &required).is_ok());
        assert!(validate_descriptor_shape_parts(&manifest, 2, 1, &required).is_err());
        assert!(validate_descriptor_shape_parts(&manifest, 1, 2, &required).is_err());
        let mut extra = required;
        extra.push(CredentialDescriptor {
            credential_capability_id: "extra".into(),
            fd: 9,
            sha256: "b".repeat(64),
            bytes: 1,
        });
        assert!(validate_descriptor_shape_parts(&manifest, 1, 1, &extra).is_err());
        extra.push(CredentialDescriptor {
            credential_capability_id: extra[0].credential_capability_id.clone(),
            fd: 10,
            sha256: "c".repeat(64),
            bytes: 1,
        });
        assert!(validate_descriptor_shape_parts(&manifest, 1, 1, &extra).is_err());
    }

    #[test]
    fn request_descriptor_exact_length_rejects_short_and_long_files() {
        for (bytes, expected, accepted) in [
            (b"abc".as_slice(), 3, true),
            (b"ab", 3, false),
            (b"abcd", 3, false),
        ] {
            let mut file = tempfile::tempfile().unwrap();
            file.write_all(bytes).unwrap();
            file.rewind().unwrap();
            let result = read_inherited_fd_exact(file.into_raw_fd(), expected);
            assert_eq!(result.is_ok(), accepted);
        }
    }

    #[test]
    fn serve_and_cleanup_results_are_reported_truthfully() {
        let cleanup_attempts = std::cell::Cell::new(0);
        let serve_error = finish_serve(Err(io::Error::other("serve failed")), || {
            cleanup_attempts.set(cleanup_attempts.get() + 1);
            Ok(())
        })
        .unwrap_err();
        assert_eq!(serve_error.to_string(), "serve failed");
        assert_eq!(cleanup_attempts.get(), 1);

        let cleanup_error =
            finish_serve(Ok(()), || Err(io::Error::other("cleanup failed"))).unwrap_err();
        assert_eq!(cleanup_error.to_string(), "cleanup failed");

        let both = finish_serve(Err(io::Error::other("serve failed")), || {
            Err(io::Error::other("cleanup failed"))
        })
        .unwrap_err();
        assert_eq!(
            both.to_string(),
            "broker serve failed: serve failed; broker cleanup failed: cleanup failed"
        );
    }

    #[test]
    fn failed_serve_reports_injected_socket_removal_failure_once() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
        drop(listener);
        let cleanup_attempts = std::cell::Cell::new(0);

        let error = finish_serve(Err(io::Error::other("serve failed")), || {
            cleanup_attempts.set(cleanup_attempts.get() + 1);
            guard.cleanup_with_socket_removal_fault_for_test()
        })
        .unwrap_err();

        assert_eq!(cleanup_attempts.get(), 1);
        assert_eq!(
            error.to_string(),
            "broker serve failed: serve failed; broker cleanup failed: injected broker socket removal failure"
        );
        assert!(directory.join("broker.sock").exists());
        std::fs::remove_file(directory.join("broker.sock")).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn failed_serve_reports_directory_replacement_cleanup_failure_once() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("stage-socket");
        let moved = root.path().join("moved-stage-socket");
        let marker = directory.join("replacement-marker");
        let (listener, guard) = crate::uds::bind_owner_only(&directory).unwrap();
        drop(listener);
        std::fs::rename(&directory, &moved).unwrap();
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(&marker, b"keep").unwrap();
        let cleanup_attempts = std::cell::Cell::new(0);

        let error = finish_serve(Err(io::Error::other("serve failed")), || {
            cleanup_attempts.set(cleanup_attempts.get() + 1);
            guard.cleanup()
        })
        .unwrap_err();

        assert_eq!(cleanup_attempts.get(), 1);
        assert_eq!(
            error.to_string(),
            "broker serve failed: serve failed; broker cleanup failed: broker socket directory path identity changed"
        );
        assert_eq!(std::fs::read(&marker).unwrap(), b"keep");
        assert!(!moved.join("broker.sock").exists());
        std::fs::remove_dir(&moved).unwrap();
        std::fs::remove_file(&marker).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }
}
