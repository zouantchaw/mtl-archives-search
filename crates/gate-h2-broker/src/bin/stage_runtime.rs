use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::Path,
};

use gate_h2_broker::model::{ExchangeRequest, ExchangeResponse};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StageProgram {
    schema_version: String,
    schema_sha256: String,
    executor_contract: String,
    action: String,
    input_artifact_roles: Vec<String>,
    output_indexes: Vec<u64>,
    broker_socket_role: String,
    one_run_token_role: String,
    https_exchange_handles: Vec<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new("/stage");
    let program: StageProgram = serde_json::from_slice(&fs::read(root.join("program.json"))?)?;
    if program.schema_version != "reviewed_metrics_stage_program_v2.2.0"
        || program.schema_sha256
            != "6d2a30170cf640279292ab4fd40ef70ccf46f47ac504bfee57a791842a301c2c"
        || program.executor_contract != "gate_h2_static_stage_program_executor_v2"
        || program.action != "invoke_exact_https_exchange"
        || program.broker_socket_role != "owner_bound_https_exchange_socket"
        || program.one_run_token_role != "broker_one_run_token"
        || program.output_indexes != [0, 1]
    {
        return Err("invalid stage program".into());
    }
    let token = fs::read_to_string("/run/gate-h2/run-token")?;
    for (ordinal, handle) in program.https_exchange_handles.iter().enumerate() {
        let role = program
            .input_artifact_roles
            .get(ordinal)
            .ok_or("missing request role")?;
        let body = fs::read(root.join("inputs").join(format!("{role}.json")))?;
        let request = ExchangeRequest {
            schema_version: gate_h2_broker::PROTOCOL_VERSION.into(),
            message_type: "exchange_request".into(),
            request_id: format!("{ordinal:032x}"),
            run_token: token.trim().into(),
            capability_handle: handle.clone(),
            request_artifact_role: role.clone(),
            request_artifact_sha256: hex::encode(Sha256::digest(&body)),
            request_artifact_bytes: body.len() as u64,
        };
        let capability_id = fs::read_to_string(
            root.join("handles")
                .join(format!("{ordinal}.capability-id")),
        )?;
        let response = call(&capability_id, &request)?;
        if response.outcome != "accepted" {
            return Err("broker exchange failed closed".into());
        }
        commit_receipt(
            &root.join("outputs"),
            ordinal,
            &serde_json::to_vec(&response)?,
        )?;
    }
    Ok(())
}

fn commit_receipt(
    directory: &Path,
    ordinal: usize,
    bytes: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let path = directory.join(format!("{ordinal}.receipt.json"));
    let temporary = directory.join(format!(".{ordinal}.receipt.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)?;
    fs::File::open(directory)?.sync_all()?;
    Ok(())
}

fn call(
    capability_id: &str,
    request: &ExchangeRequest,
) -> Result<ExchangeResponse, Box<dyn std::error::Error>> {
    let body = serde_json::to_vec(request)?;
    let mut stream = UnixStream::connect("/run/gate-h2/broker.sock")?;
    write!(
        stream,
        "POST /v1/exchange/{} HTTP/1.1\r\nhost: gate-h2\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        capability_id.trim(),
        body.len()
    )?;
    stream.write_all(&body)?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let split = response
        .windows(4)
        .position(|v| v == b"\r\n\r\n")
        .ok_or("malformed broker response")?
        + 4;
    Ok(serde_json::from_slice(&response[split..])?)
}
