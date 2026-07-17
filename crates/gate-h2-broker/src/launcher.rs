use std::{
    collections::HashMap,
    fs::File,
    io::{self, Read, Write},
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
    evidence::{AuthorityBindings, EvidenceWriter, SystemClock, canonical_json},
    model::{FilePin, Manifest, SchemaPin},
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
const MAX_AUTHORIZATION_LIFETIME_MS: u64 = 24 * 60 * 60 * 1000;

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
    replay_directory: PathBuf,
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
    let trust = embedded_launch_authority_trust()?;
    validate_admission(&config, &value, &trust, unix_time_millis()?)?;
    validate_file_pin(std::env::current_exe()?.as_path(), &config.broker_binary)?;
    validate_file_pin(&config.stage_runtime_path, &config.stage_runtime)?;
    if config.manifest.capabilities.iter().any(|capability| {
        capability.broker_binary.sha256 != config.broker_binary.sha256
            || capability.broker_binary.bytes != config.broker_binary.bytes
            || capability.broker_binary.version != config.broker_binary.version
    }) {
        return Err("manifest broker binary pin mismatch".into());
    }
    claim_authorization_once(
        &trust,
        &config.launch_authorization.authorization_id,
        config.launch_authorization.sequence,
    )?;

    let run_token =
        SecretBytes::from_sealed_inherited_fd(config.run_token_fd, &config.run_token_sha256, 128)?;
    let signing_key = SecretBytes::from_sealed_inherited_fd(
        config.signing_key_fd,
        &config.signing_key_sha256,
        128,
    )?;
    let mut credentials = HashMap::new();
    for descriptor in config.credentials {
        if credentials.contains_key(&descriptor.credential_capability_id) {
            return Err("duplicate credential capability".into());
        }
        let secret = SecretBytes::from_sealed_inherited_fd(
            descriptor.fd,
            &descriptor.sha256,
            MAX_SECRET_BYTES,
        )?;
        credentials.insert(descriptor.credential_capability_id, secret);
    }
    let mut request_bodies = Vec::with_capacity(config.request_body_fds.len());
    for fd in config.request_body_fds {
        request_bodies.push(read_inherited_fd(fd, MAX_REQUEST_BYTES)?);
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
    let (listener, _guard) = crate::uds::bind_owner_only(&config.socket_directory)?;
    crate::uds::serve(listener, Arc::new(Mutex::new(broker)))?;
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
    let mut fds = vec![config.run_token_fd, config.signing_key_fd];
    fds.extend(config.request_body_fds.iter().copied());
    fds.extend(config.credentials.iter().map(|credential| credential.fd));
    let mut unique = std::collections::HashSet::new();
    if fds.iter().any(|fd| *fd < 3 || !unique.insert(*fd)) {
        return Err("inherited descriptors must be unique and nonstandard".into());
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
    authorization_id: &str,
    sequence: u64,
) -> io::Result<()> {
    use std::os::unix::{
        ffi::OsStrExt,
        fs::{MetadataExt, PermissionsExt},
    };
    if !trust.replay_directory.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "launch replay state must be absolute",
        ));
    }
    let directory_path = std::ffi::CString::new(trust.replay_directory.as_os_str().as_bytes())?;
    let directory_fd = unsafe {
        libc::open(
            directory_path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if directory_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let directory = File::from(unsafe { OwnedFd::from_raw_fd(directory_fd) });
    let metadata = directory.metadata()?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o077 != 0
        || authorization_id.len() != 64
        || !authorization_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe launch replay state",
        ));
    }
    if unsafe { libc::flock(directory.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let highest_name = std::ffi::CString::new("highest-sequence")?;
    let highest_fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            highest_name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if highest_fd >= 0 {
        let mut highest_file = File::from(unsafe { OwnedFd::from_raw_fd(highest_fd) });
        let highest_metadata = highest_file.metadata()?;
        if !highest_metadata.file_type().is_file()
            || highest_metadata.nlink() != 1
            || highest_metadata.permissions().mode() & 0o077 != 0
            || highest_metadata.len() > 21
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unsafe launch sequence state",
            ));
        }
        let mut highest_bytes = Vec::new();
        Read::by_ref(&mut highest_file)
            .take(32)
            .read_to_end(&mut highest_bytes)?;
        let highest = std::str::from_utf8(&highest_bytes)
            .ok()
            .and_then(|value| value.strip_suffix('\n'))
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid launch sequence state")
            })?;
        if sequence <= highest {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "launch authorization sequence is replayed or rolled back",
            ));
        }
    } else if io::Error::last_os_error().kind() != io::ErrorKind::NotFound {
        return Err(io::Error::last_os_error());
    }
    let name = std::ffi::CString::new(format!("{authorization_id}.used"))?;
    let marker_fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if marker_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut file = File::from(unsafe { OwnedFd::from_raw_fd(marker_fd) });
    file.write_all(b"gate-h2-launch-authorization-consumed-v1\n")?;
    file.sync_all()?;
    let sequence_temporary_name =
        std::ffi::CString::new(format!(".{authorization_id}.sequence.tmp"))?;
    let sequence_fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            sequence_temporary_name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if sequence_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut sequence_file = File::from(unsafe { OwnedFd::from_raw_fd(sequence_fd) });
    writeln!(sequence_file, "{sequence}")?;
    sequence_file.sync_all()?;
    if unsafe {
        libc::renameat(
            directory.as_raw_fd(),
            sequence_temporary_name.as_ptr(),
            directory.as_raw_fd(),
            highest_name.as_ptr(),
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    directory.sync_all()
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

fn validate_file_pin(path: &Path, pin: &FilePin) -> io::Result<()> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() != pin.bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file pin length mismatch",
        ));
    }
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash)?;
    if hex::encode(hash.finalize()) != pin.sha256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file pin hash mismatch",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn authorized_value(root: &Path, seed: [u8; 32]) -> (serde_json::Value, LaunchAuthorityTrust) {
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
            replay_directory: root.to_path_buf(),
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
        claim_authorization_once(&trust, &id, 7).unwrap();
        assert!(claim_authorization_once(&trust, &id, 7).is_err());
        assert!(claim_authorization_once(&trust, &"f".repeat(64), 6).is_err());
        claim_authorization_once(&trust, &"e".repeat(64), 8).unwrap();
    }
}
