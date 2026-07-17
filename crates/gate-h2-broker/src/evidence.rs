use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::credential::SecretBytes;
use crate::{TRANSCRIPT_VERSION, model::SchemaPin};

type HmacSha256 = Hmac<Sha256>;
const EVENT_DOMAIN: &[u8] = b"gate-h2-https-broker-event-v1-schema-bound\0";
const TRANSCRIPT_DOMAIN: &[u8] = b"gate-h2-https-broker-transcript-v1-schema-bound\0";

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

#[derive(Debug, Serialize)]
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

pub trait Clock: Send + Sync {
    fn now(&self) -> String;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> String {
        let duration = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before epoch");
        let seconds = duration.as_secs() as libc::time_t;
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
            duration.subsec_millis()
        )
    }
}

pub struct EvidenceWriter {
    directory: PathBuf,
    signing_key: SecretBytes,
    pub events: Vec<Event>,
    pub event_schema_pin: SchemaPin,
    pub transcript_schema_pin: SchemaPin,
}

impl EvidenceWriter {
    pub fn new(
        directory: PathBuf,
        signing_key: SecretBytes,
        event_schema_pin: SchemaPin,
        transcript_schema_pin: SchemaPin,
    ) -> io::Result<Self> {
        fs::create_dir(&directory)?;
        fs::set_permissions(
            &directory,
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )?;
        Ok(Self {
            directory,
            signing_key,
            events: Vec::new(),
            event_schema_pin,
            transcript_schema_pin,
        })
    }

    pub fn append(&mut self, mut event: Event) -> io::Result<()> {
        event.event_id = domain_id(EVENT_DOMAIN, &event, "event_id")?;
        let bytes = canonical_json(&serde_json::to_value(&event)?);
        let path = self
            .directory
            .join(format!("event-{:04}.json", event.sequence));
        atomic_fsync(&path, bytes.as_bytes(), 0o600)?;
        self.events.push(event);
        Ok(())
    }

    pub fn seal(&mut self, mut transcript: Transcript) -> io::Result<(PathBuf, String)> {
        transcript.transcript_id = domain_id(TRANSCRIPT_DOMAIN, &transcript, "transcript_id")?;
        let bytes = canonical_json(&serde_json::to_value(&transcript)?);
        let transcript_path = self.directory.join("transcript.json");
        atomic_fsync(&transcript_path, bytes.as_bytes(), 0o600)?;
        let mut mac = HmacSha256::new_from_slice(self.signing_key.expose())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid signing key"))?;
        mac.update(b"gate-h2-transcript-signature-v1\0");
        mac.update(bytes.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());
        let envelope = serde_json::json!({
            "schema_version": "gate_h2_https_broker_transcript_signature_v1.0.0",
            "algorithm": "hmac-sha256",
            "key_commitment": hex::encode(Sha256::digest(self.signing_key.expose())),
            "transcript_id": transcript.transcript_id,
            "transcript_sha256": hex::encode(Sha256::digest(bytes.as_bytes())),
            "signature": signature
        });
        atomic_fsync(
            &self.directory.join("transcript.signature.json"),
            canonical_json(&envelope).as_bytes(),
            0o600,
        )?;
        File::open(&self.directory)?.sync_all()?;
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
            serde_json::to_string(value).unwrap()
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
                    .map(|(k, v)| format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonical_json(v)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn domain_id<T: Serialize>(domain: &[u8], value: &T, id_field: &str) -> io::Result<String> {
    let mut object = match serde_json::to_value(value)? {
        Value::Object(v) => v,
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

fn atomic_fsync(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(mode);
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    File::open(path.parent().unwrap())?.sync_all()
}

pub fn commit_output(directory: &Path, role: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    if role.is_empty()
        || !role
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid output role",
        ));
    }
    fs::create_dir_all(directory)?;
    fs::set_permissions(
        directory,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )?;
    let path = directory.join(format!("{role}.json"));
    atomic_fsync(&path, bytes, 0o600)?;
    Ok(path)
}

use std::os::unix::fs::OpenOptionsExt;
