use std::{
    collections::HashMap,
    fs::File,
    io::{self, Read},
    os::fd::{FromRawFd, OwnedFd, RawFd},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{
    Broker, BrokerConfig, ProductionNetworkClient,
    credential::{MAX_SECRET_BYTES, SecretBytes},
    evidence::{AuthorityBindings, EvidenceWriter, SystemClock, canonical_json},
    model::{FilePin, Manifest, SchemaPin},
};

const CONFIG_DOMAIN: &[u8] = b"gate-h2-production-launch-config-v1\0";
const ADMITTED_CONFIG_ID: Option<&str> = option_env!("GATE_H2_ADMITTED_CONFIG_ID");
const MAX_CONFIG_BYTES: usize = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LaunchConfig {
    schema_version: String,
    admission_id: String,
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
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialDescriptor {
    credential_capability_id: String,
    fd: RawFd,
    sha256: String,
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
    validate_admission(&config, value)?;
    validate_file_pin(std::env::current_exe()?.as_path(), &config.broker_binary)?;
    validate_file_pin(&config.stage_runtime_path, &config.stage_runtime)?;
    if config.manifest.capabilities.iter().any(|capability| {
        capability.broker_binary.sha256 != config.broker_binary.sha256
            || capability.broker_binary.bytes != config.broker_binary.bytes
            || capability.broker_binary.version != config.broker_binary.version
    }) {
        return Err("manifest broker binary pin mismatch".into());
    }

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

    let network = ProductionNetworkClient::new(&config.trust_roots.sha256)?;
    if network.trust_root_sha256() != config.trust_roots.sha256 {
        return Err("native trust root pin mismatch".into());
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
    value: serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    if config.schema_version != "gate_h2_production_launch_config_v1.0.0"
        || config.authority_state != "admitted_gate_h2_broker_v1"
    {
        return Err("production authority is not admitted".into());
    }
    if compute_admission_id(value)? != config.admission_id {
        return Err("launch config admission ID mismatch".into());
    }
    if ADMITTED_CONFIG_ID != Some(config.admission_id.as_str()) {
        return Err("this binary was not built for the admitted launch config".into());
    }
    let mut fds = vec![config.run_token_fd, config.signing_key_fd];
    fds.extend(config.request_body_fds.iter().copied());
    fds.extend(config.credentials.iter().map(|credential| credential.fd));
    let mut unique = std::collections::HashSet::new();
    if fds.iter().any(|fd| *fd < 3 || !unique.insert(*fd)) {
        return Err("inherited descriptors must be unique and nonstandard".into());
    }
    Ok(())
}

fn compute_admission_id(
    mut value: serde_json::Value,
) -> Result<String, Box<dyn std::error::Error>> {
    value
        .as_object_mut()
        .ok_or("launch config must be an object")?
        .remove("admission_id");
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
    file.by_ref()
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

    #[test]
    fn launch_admission_id_binds_exact_config_bytes() {
        let first = serde_json::json!({
            "admission_id": "ignored",
            "authority_state": "admitted_gate_h2_broker_v1",
            "schema_version": "gate_h2_production_launch_config_v1.0.0"
        });
        let mut second = first.clone();
        second["authority_state"] = serde_json::json!("changed");
        assert_ne!(
            compute_admission_id(first).unwrap(),
            compute_admission_id(second).unwrap()
        );
    }

    #[test]
    fn ordinary_build_has_no_production_authority() {
        assert!(ADMITTED_CONFIG_ID.is_none());
    }
}
