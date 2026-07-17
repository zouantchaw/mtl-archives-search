use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    TRANSCRIPT_VERSION,
    credential::SecretBytes,
    model::{FilePin, SchemaPin},
};

const EVENT_DOMAIN: &[u8] = b"gate-h2-https-broker-event-v1-schema-bound\0";
const TRANSCRIPT_DOMAIN: &[u8] = b"gate-h2-https-broker-transcript-v1-schema-bound\0";
const AUTHORITY_DOMAIN: &[u8] = b"gate-h2-https-broker-authority-envelope-v2-schema-bound\0";
const SIGNATURE_DOMAIN: &[u8] = b"gate-h2-https-broker-authority-signature-ed25519-v2\0";
const EVENT_SCHEMA_SHA256: &str =
    "5c33ce7a3dcee39b87b65f6c8dd196c1a56b8fc8d31ef5ad30684735121e152f";
const TRANSCRIPT_SCHEMA_SHA256: &str =
    "15fc05df41acd422321ccf8e2b834526059f594424d5f675a7f0ce3248169db2";
const AUTHORITY_SCHEMA_SHA256: &str =
    "d7752a9c8325ed7537a58cbe3515cee146e5fb1c122c7a536d1ed8eedf79e079";

#[derive(Clone, Debug, Serialize)]
pub struct Event {
    pub schema_version: &'static str,
    pub schema_pin: SchemaPin,
    pub event_id: String,
    pub manifest_id: String,
    pub capability_id: String,
    pub candidate_id: String,
    pub stage_id: String,
    pub exchange_ordinal: usize,
    pub sequence: usize,
    pub event_type: &'static str,
    pub occurred_at: String,
    pub outcome: &'static str,
    pub evidence: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct Transcript {
    pub schema_version: &'static str,
    pub schema_pin: SchemaPin,
    pub transcript_id: String,
    pub manifest_id: String,
    pub candidate_id: String,
    pub stage_id: String,
    pub run_token_commitment: String,
    pub socket_identity_sha256: String,
    pub started_at: String,
    pub ended_at: String,
    pub expected_exchange_count: usize,
    pub attempted_exchange_count: usize,
    pub completed_exchange_count: usize,
    pub final_outcome: &'static str,
    pub events: Vec<Event>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuthorityBindings {
    pub schema_pin: SchemaPin,
    pub d1_attempt_id: String,
    pub d1_begin_sha256: String,
    pub session_id: String,
    pub attempt_id: String,
    pub broker_binary: FilePin,
    pub stage_runtime: FilePin,
    pub trust_roots: FilePin,
    pub signer_id: String,
    pub signer_trust_entry_sha256: String,
}

#[derive(Debug, Serialize)]
struct AuthorityEnvelope {
    schema_version: &'static str,
    schema_pin: SchemaPin,
    envelope_id: String,
    transcript_id: String,
    transcript_sha256: String,
    manifest_id: String,
    d1_attempt_id: String,
    d1_begin_sha256: String,
    session_id: String,
    attempt_id: String,
    broker_binary: FilePin,
    stage_runtime: FilePin,
    trust_roots: FilePin,
    socket_identity_sha256: String,
    run_token_commitment: String,
    final_outcome: &'static str,
    signer_id: String,
    signer_trust_entry_sha256: String,
    public_key_base64url: String,
    signature_algorithm: &'static str,
    signature_base64url: String,
}

pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}

#[derive(Default)]
pub struct SystemClock {
    last_millis: Mutex<u128>,
}

impl Clock for SystemClock {
    fn now(&self) -> String {
        let wall = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_millis();
        let millis = {
            let mut last = self.last_millis.lock().expect("clock mutex poisoned");
            let next = wall.max(last.saturating_add(1));
            *last = next;
            next
        };
        format_unix_millis(millis)
    }
}

pub struct EvidenceWriter {
    directory: PathBuf,
    signing_key: SigningKey,
    authority: AuthorityBindings,
    pub events: Vec<Event>,
    pub event_schema_pin: SchemaPin,
    pub transcript_schema_pin: SchemaPin,
    sealed: bool,
}

impl EvidenceWriter {
    pub fn new(
        directory: PathBuf,
        signing_key_material: SecretBytes,
        event_schema_pin: SchemaPin,
        transcript_schema_pin: SchemaPin,
        authority: AuthorityBindings,
    ) -> io::Result<Self> {
        validate_schema_pin(
            &event_schema_pin,
            EVENT_SCHEMA_SHA256,
            3920,
            "gate_h2_https_broker_event_v1.0.0",
        )?;
        validate_schema_pin(
            &transcript_schema_pin,
            TRANSCRIPT_SCHEMA_SHA256,
            2045,
            TRANSCRIPT_VERSION,
        )?;
        validate_authority(&authority)?;
        let mut decoded = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(signing_key_material.expose())
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid signing key"))?,
        );
        let seed = Zeroizing::new(
            decoded
                .as_slice()
                .try_into()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid signing key"))?,
        );
        let signing_key = SigningKey::from_bytes(&seed);
        decoded.zeroize();
        let public_key = URL_SAFE_NO_PAD.encode(signing_key.verifying_key().as_bytes());
        let derived_signer_id = hex::encode(Sha256::digest(
            [
                b"gate-h2-ed25519-signer-v1\0".as_slice(),
                public_key.as_bytes(),
            ]
            .concat(),
        ));
        if derived_signer_id != authority.signer_id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "signing key does not match signer identity",
            ));
        }
        create_private_directory(&directory)?;
        Ok(Self {
            directory,
            signing_key,
            authority,
            events: Vec::new(),
            event_schema_pin,
            transcript_schema_pin,
            sealed: false,
        })
    }

    pub fn append(&mut self, mut event: Event) -> io::Result<()> {
        if self.sealed {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "evidence is sealed",
            ));
        }
        event.event_id = domain_id(EVENT_DOMAIN, &event, "event_id")?;
        let bytes = canonical_json(&serde_json::to_value(&event)?);
        atomic_fsync(
            &self
                .directory
                .join(format!("event-{:04}.json", event.sequence)),
            bytes.as_bytes(),
            0o600,
        )?;
        self.events.push(event);
        Ok(())
    }

    pub fn seal(&mut self, mut transcript: Transcript) -> io::Result<(PathBuf, String)> {
        if self.sealed {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "evidence is sealed",
            ));
        }
        transcript.transcript_id = domain_id(TRANSCRIPT_DOMAIN, &transcript, "transcript_id")?;
        let transcript_bytes = canonical_json(&serde_json::to_value(&transcript)?);
        let transcript_path = self.directory.join("transcript.v1.json");
        atomic_fsync(&transcript_path, transcript_bytes.as_bytes(), 0o600)?;

        let public_key_base64url =
            URL_SAFE_NO_PAD.encode(self.signing_key.verifying_key().as_bytes());
        let mut envelope = AuthorityEnvelope {
            schema_version: "gate_h2_https_broker_authority_envelope_v2.0.0",
            schema_pin: self.authority.schema_pin.clone(),
            envelope_id: String::new(),
            transcript_id: transcript.transcript_id.clone(),
            transcript_sha256: hex::encode(Sha256::digest(transcript_bytes.as_bytes())),
            manifest_id: transcript.manifest_id.clone(),
            d1_attempt_id: self.authority.d1_attempt_id.clone(),
            d1_begin_sha256: self.authority.d1_begin_sha256.clone(),
            session_id: self.authority.session_id.clone(),
            attempt_id: self.authority.attempt_id.clone(),
            broker_binary: self.authority.broker_binary.clone(),
            stage_runtime: self.authority.stage_runtime.clone(),
            trust_roots: self.authority.trust_roots.clone(),
            socket_identity_sha256: transcript.socket_identity_sha256.clone(),
            run_token_commitment: transcript.run_token_commitment.clone(),
            final_outcome: transcript.final_outcome,
            signer_id: self.authority.signer_id.clone(),
            signer_trust_entry_sha256: self.authority.signer_trust_entry_sha256.clone(),
            public_key_base64url,
            signature_algorithm: "ed25519",
            signature_base64url: String::new(),
        };
        envelope.envelope_id = authority_envelope_id(&envelope)?;
        let unsigned = unsigned_envelope_bytes(&envelope)?;
        let signature = self
            .signing_key
            .sign(&[SIGNATURE_DOMAIN, unsigned.as_bytes()].concat());
        envelope.signature_base64url = URL_SAFE_NO_PAD.encode(signature.to_bytes());
        let envelope_bytes = canonical_json(&serde_json::to_value(&envelope)?);
        atomic_fsync(
            &self.directory.join("transcript.authority.v2.json"),
            envelope_bytes.as_bytes(),
            0o600,
        )?;
        File::open(&self.directory)?.sync_all()?;
        self.sealed = true;
        Ok((transcript_path, transcript.transcript_id))
    }
}

pub fn transcript_base(schema_pin: SchemaPin) -> Transcript {
    Transcript {
        schema_version: TRANSCRIPT_VERSION,
        schema_pin,
        transcript_id: String::new(),
        manifest_id: String::new(),
        candidate_id: String::new(),
        stage_id: String::new(),
        run_token_commitment: String::new(),
        socket_identity_sha256: String::new(),
        started_at: String::new(),
        ended_at: String::new(),
        expected_exchange_count: 0,
        attempted_exchange_count: 0,
        completed_exchange_count: 0,
        final_outcome: "failed_closed",
        events: Vec::new(),
    }
}

pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).expect("serializable JSON scalar")
        }
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let sorted: std::collections::BTreeMap<&String, &Value> = values.iter().collect();
            format!(
                "{{{}}}",
                sorted
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("serializable JSON key"),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn unsigned_envelope_bytes(envelope: &AuthorityEnvelope) -> io::Result<String> {
    let mut value = serde_json::to_value(envelope)?;
    value
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "authority object required"))?
        .remove("signature_base64url");
    Ok(canonical_json(&value))
}

fn authority_envelope_id(envelope: &AuthorityEnvelope) -> io::Result<String> {
    let mut value = serde_json::to_value(envelope)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "authority object required"))?;
    object.remove("envelope_id");
    object.remove("signature_base64url");
    let mut hash = Sha256::new();
    hash.update(AUTHORITY_DOMAIN);
    hash.update(canonical_json(&value));
    Ok(hex::encode(hash.finalize()))
}

fn domain_id<T: Serialize>(domain: &[u8], value: &T, id_field: &str) -> io::Result<String> {
    let mut object = match serde_json::to_value(value)? {
        Value::Object(value) => value,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "ID object required",
            ));
        }
    };
    object.remove(id_field);
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(canonical_json(&Value::Object(object)));
    Ok(hex::encode(hash.finalize()))
}

fn validate_schema_pin(pin: &SchemaPin, sha256: &str, bytes: u64, version: &str) -> io::Result<()> {
    if pin.sha256 != sha256 || pin.bytes != bytes || pin.schema_version != version {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "untrusted schema pin",
        ));
    }
    Ok(())
}

fn validate_authority(authority: &AuthorityBindings) -> io::Result<()> {
    validate_schema_pin(
        &authority.schema_pin,
        AUTHORITY_SCHEMA_SHA256,
        2697,
        "gate_h2_https_broker_authority_envelope_v2.0.0",
    )?;
    let identifiers = [
        &authority.d1_attempt_id,
        &authority.session_id,
        &authority.attempt_id,
    ];
    if identifiers.iter().any(|value| {
        value.is_empty()
            || !value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)
            })
    }) || !is_sha256(&authority.d1_begin_sha256)
        || !is_sha256(&authority.signer_id)
        || !is_sha256(&authority.signer_trust_entry_sha256)
        || !valid_file_pin(&authority.broker_binary)
        || !valid_file_pin(&authority.stage_runtime)
        || !valid_file_pin(&authority.trust_roots)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid evidence authority",
        ));
    }
    Ok(())
}

fn valid_file_pin(pin: &FilePin) -> bool {
    is_sha256(&pin.sha256) && pin.bytes > 0 && !pin.version.is_empty()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe evidence directory",
        ));
    }
    Ok(())
}

fn atomic_fsync(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    atomic_fsync_inner(path, bytes, mode, true)
}

fn atomic_fsync_raw(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    atomic_fsync_inner(path, bytes, mode, false)
}

fn atomic_fsync_inner(path: &Path, bytes: &[u8], mode: u32, newline: bool) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(mode);
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    if newline {
        file.write_all(b"\n")?;
    }
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    File::open(path.parent().expect("path has parent"))?.sync_all()
}

pub struct CommittedOutput {
    pub path: PathBuf,
    pub sha256: String,
    pub bytes: u64,
}

pub fn commit_output(directory: &Path, role: &str, bytes: &[u8]) -> io::Result<CommittedOutput> {
    use std::os::unix::fs::PermissionsExt;
    if role.is_empty()
        || !role
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid output role",
        ));
    }
    if !directory.exists() {
        create_private_directory(directory)?;
    }
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.file_type().is_dir()
        || metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe output directory",
        ));
    }
    let path = directory.join(format!("{role}.bin"));
    atomic_fsync_raw(&path, bytes, 0o600)?;
    let mut committed = File::open(&path)?;
    let metadata = committed.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() != bytes.len() as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output length mismatch",
        ));
    }
    let mut hash = Sha256::new();
    let read_bytes = io::copy(&mut committed, &mut hash)?;
    if read_bytes != metadata.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "committed output readback mismatch",
        ));
    }
    Ok(CommittedOutput {
        path,
        sha256: hex::encode(hash.finalize()),
        bytes: read_bytes,
    })
}

fn format_unix_millis(millis: u128) -> String {
    let seconds = (millis / 1000) as libc::time_t;
    let mut broken_down: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::gmtime_r(&seconds, &mut broken_down) };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        broken_down.tm_year + 1900,
        broken_down.tm_mon + 1,
        broken_down.tm_mday,
        broken_down.tm_hour,
        broken_down.tm_min,
        broken_down.tm_sec,
        millis % 1000
    )
}
