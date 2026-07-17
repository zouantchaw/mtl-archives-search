use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::model::{AuthScheme, Capability, Manifest};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};

pub const CAPABILITY_DOMAIN: &[u8] = b"gate-h2-https-exchange-capability-v1-schema-bound\0";
pub const MANIFEST_DOMAIN: &[u8] = b"gate-h2-https-exchange-manifest-v1-schema-bound\0";

pub fn validate_manifest(manifest: &Manifest) -> Result<(), &'static str> {
    if manifest.schema_version != "gate_h2_https_exchange_manifest_v1.0.0"
        || manifest.authorization_version != "reviewed_metrics_execution_authorization_v2.5.0"
        || manifest.socket_owner != "host_broker"
        || manifest.raw_network_policy != "deny_all"
        || !valid_identifier(&manifest.candidate_id, true)
        || !valid_identifier(&manifest.stage_id, false)
        || manifest.exact_exchange_count == 0
        || manifest.exact_exchange_count > 16
        || manifest.exact_exchange_count != manifest.capabilities.len()
        || manifest.schema_pin.sha256
            != "0a6c3e12cb2c8e6ee49d16692446d80897c858635708b902ad6732ea9d4fc8df"
        || manifest.schema_pin.bytes != 1416
        || manifest.schema_pin.schema_version != manifest.schema_version
        || object_id(MANIFEST_DOMAIN, manifest, "manifest_id").as_deref()
            != Some(manifest.manifest_id.as_str())
    {
        return Err("invalid_manifest");
    }
    let mut roles = std::collections::HashSet::new();
    for (ordinal, capability) in manifest.capabilities.iter().enumerate() {
        validate_capability(manifest, capability, ordinal)?;
        if !roles.insert(&capability.raw_response_output_role) {
            return Err("duplicate_output_role");
        }
    }
    Ok(())
}

fn validate_capability(
    manifest: &Manifest,
    c: &Capability,
    ordinal: usize,
) -> Result<(), &'static str> {
    if c.schema_version != "gate_h2_https_exchange_capability_v1.0.0"
        || c.candidate_id != manifest.candidate_id
        || c.stage_id != manifest.stage_id
        || c.exchange_ordinal != ordinal
        || c.protocol_pin != "https_exchange_uds_v1"
        || !valid_identifier(&c.purpose, false)
        || !valid_identifier(&c.request_artifact.artifact_role, false)
        || !valid_identifier(&c.raw_response_output_role, false)
        || !valid_file_pin(&c.broker_binary)
        || c.protocol_schema.sha256
            != "722606cff23e7debbeefdb7bcb8b7ec72b3fb5752cd10786695308cce120eb82"
        || c.protocol_schema.bytes != 2702
        || c.protocol_schema.version != "gate_h2_https_exchange_uds_v1.0.0"
        || c.port != 443
        || !valid_hostname(&c.hostname)
        || !valid_target(&c.path_query)
        || c.fixed_headers.accept != "application/json"
        || c.fixed_headers.content_type != "application/json"
        || c.fixed_headers.serialization != "accept: SP value CRLF; content-type: SP value CRLF"
        || c.request_artifact.media_type != "application/json"
        || c.request_artifact.bytes > c.request_byte_cap
        || c.request_byte_cap > 16_777_216
        || c.response_byte_cap == 0
        || c.response_byte_cap > 16_777_216
        || !(1..=30_000).contains(&c.connect_deadline_ms)
        || !(1..=300_000).contains(&c.exchange_deadline_ms)
        || c.content_encoding != "identity"
        || c.redirect_policy != "forbid_all"
        || c.retry_policy != "no_automatic_retries"
        || c.allowed_response_statuses.is_empty()
        || c.allowed_response_statuses
            .iter()
            .any(|status| !(200..=599).contains(status))
        || c.allowed_response_statuses
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != c.allowed_response_statuses.len()
        || c.allowed_response_media_types.as_slice() != ["application/json"]
        || c.dns_policy
            != json!({"resolution_owner":"host_broker","resolve_once_per_exchange":true,"connect_only_to_resolved_set":true,"re_resolve_forbidden":true,"forbidden_ip_ranges":["unspecified","loopback","link_local","private","carrier_grade_nat","documentation","benchmark","multicast","reserved"],"mixed_allowed_forbidden_answer":"reject_entire_exchange"})
        || c.tls_policy
            != json!({"sni":"exact_capability_hostname","hostname_verification":"exact_capability_hostname","pkix":"system_trust_store_required","minimum_tls_version":"TLSv1.3","custom_ca_roots":"forbidden"})
        || c.replay_policy
            != json!({"one_run_token":true,"single_use_handle":true,"exact_order_enforced":true,"consume_on_attempt":true})
        || c.schema_pin.sha256 != "d7d9a23b02973bd8d2970f3982183c61bd29c551452afbd8939448b93c19afee"
        || c.schema_pin.bytes != 7292
        || c.schema_pin.schema_version != c.schema_version
        || object_id(CAPABILITY_DOMAIN, c, "capability_id").as_deref()
            != Some(c.capability_id.as_str())
    {
        return Err("invalid_capability");
    }
    if c.auth_policy.injection_owner != "host_broker"
        || c.auth_policy.stage_visibility != "never"
        || c.auth_policy.credential_capability_id.len() != 64
        || !c
            .auth_policy
            .credential_capability_id
            .bytes()
            .all(is_lower_hex)
    {
        return Err("invalid_auth_policy");
    }
    match c.auth_policy.scheme {
        AuthScheme::None
            if c.auth_policy.header_name.is_none()
                && c.auth_policy.insertion_order == "no_auth_header"
                && c.auth_policy.serialization == "no_auth_header"
                && c.auth_policy.collision_policy == "not_applicable" =>
        {
            Ok(())
        }
        AuthScheme::Bearer
            if c.auth_policy.header_name.as_deref() == Some("authorization")
                && auth_insertion_exact(c) =>
        {
            Ok(())
        }
        AuthScheme::ApiKeyHeader
            if c.auth_policy.header_name.as_deref() == Some("x-api-key")
                && auth_insertion_exact(c) =>
        {
            Ok(())
        }
        _ => Err("invalid_auth_policy"),
    }
}

fn auth_insertion_exact(c: &Capability) -> bool {
    c.auth_policy.insertion_order == "after_fixed_headers_before_transport_headers"
        && c.auth_policy.serialization == "lowercase_name_colon_sp_value_crlf"
        && c.auth_policy.collision_policy == "reject_before_serialization"
}

fn valid_hostname(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value == value.to_ascii_lowercase()
        && value.parse::<IpAddr>().is_err()
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

fn valid_identifier(value: &str, allow_hyphen: bool) -> bool {
    !value.is_empty()
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || allow_hyphen && b == b'-'
        })
}

fn valid_file_pin(pin: &crate::model::FilePin) -> bool {
    pin.bytes > 0
        && !pin.version.is_empty()
        && pin.sha256.len() == 64
        && pin.sha256.bytes().all(is_lower_hex)
}

pub fn object_id<T: Serialize>(domain: &[u8], value: &T, field: &str) -> Option<String> {
    let value = serde_json::to_value(value).ok()?;
    let mut object = value.as_object()?.clone();
    object.remove(field)?;
    let canonical = crate::evidence::canonical_json(&serde_json::Value::Object(object));
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(canonical);
    Some(hex::encode(hash.finalize()))
}

fn valid_target(value: &str) -> bool {
    if !value.starts_with('/')
        || value.starts_with("//")
        || value.contains('#')
        || value.bytes().any(|b| b <= 0x20 || b >= 0x7f)
        || value
            .split('?')
            .next()
            .unwrap_or("")
            .split('/')
            .any(|s| s == "." || s == "..")
    {
        return false;
    }
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
                || bytes[index + 1].is_ascii_lowercase()
                || bytes[index + 2].is_ascii_lowercase()
            {
                return false;
            }
            let octet = u8::from_str_radix(&value[index + 1..index + 3], 16).unwrap();
            if !(0x21..=0x7e).contains(&octet)
                || octet.is_ascii_alphanumeric()
                || b"-._~".contains(&octet)
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    if let Some((_, query)) = value.split_once('?') {
        let mut names = std::collections::HashSet::new();
        for pair in query.split('&') {
            let Some((name, _)) = pair.split_once('=') else {
                return false;
            };
            if name.is_empty() || name.contains('%') || !names.insert(name) {
                return false;
            }
        }
    }
    true
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

pub fn validate_dns_answers(addresses: &[IpAddr]) -> Result<Vec<IpAddr>, &'static str> {
    if addresses.is_empty() || addresses.iter().any(|ip| is_forbidden(*ip)) {
        return Err("dns_forbidden");
    }
    let mut sorted = addresses.to_vec();
    sorted.sort();
    sorted.dedup();
    Ok(sorted)
}

pub fn verify_connected_peer(resolved: &[IpAddr], peer: IpAddr) -> Result<(), &'static str> {
    if is_forbidden(peer) || !resolved.contains(&peer) {
        return Err("dns_rebinding");
    }
    Ok(())
}

pub fn is_forbidden(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => forbidden_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return forbidden_v4(v4);
            }
            v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || in_v6(v6, "fe80::".parse().unwrap(), 10)
                || in_v6(v6, "fc00::".parse().unwrap(), 7)
                || in_v6(v6, "2001:db8::".parse().unwrap(), 32)
                || in_v6(v6, "2001:2::".parse().unwrap(), 48)
                || in_v6(v6, "100::".parse().unwrap(), 64)
                || in_v6(v6, "ff00::".parse().unwrap(), 8)
        }
    }
}

fn forbidden_v4(v: Ipv4Addr) -> bool {
    let n = u32::from(v);
    const RANGES: &[(u32, u8)] = &[
        (0x00000000, 8),
        (0x0a000000, 8),
        (0x64400000, 10),
        (0x7f000000, 8),
        (0xa9fe0000, 16),
        (0xac100000, 12),
        (0xc0000000, 24),
        (0xc0000200, 24),
        (0xc0586300, 24),
        (0xc0a80000, 16),
        (0xc6120000, 15),
        (0xc6336400, 24),
        (0xcb007100, 24),
        (0xe0000000, 4),
        (0xf0000000, 4),
    ];
    RANGES
        .iter()
        .any(|(base, bits)| n >> (32 - bits) == base >> (32 - bits))
}

fn in_v6(value: Ipv6Addr, base: Ipv6Addr, bits: u8) -> bool {
    u128::from(value) >> (128 - bits) == u128::from(base) >> (128 - bits)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_every_forbidden_family_and_mapped_alias() {
        for value in [
            "0.0.0.0",
            "127.0.0.1",
            "10.1.2.3",
            "100.64.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.0.2.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "fe80::1",
            "fc00::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(is_forbidden(value.parse().unwrap()), "{value}");
        }
        assert!(!is_forbidden("93.184.216.34".parse().unwrap()));
        assert!(!is_forbidden(
            "2606:2800:220:1:248:1893:25c8:1946".parse().unwrap()
        ));
    }
}
