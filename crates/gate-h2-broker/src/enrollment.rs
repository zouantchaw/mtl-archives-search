use std::io;

use serde::Deserialize;
use sha2::{Digest, Sha256};

const ENROLLMENT_BYTES: &[u8] = include_bytes!("enrollment-authority-v1.json");
const ENROLLMENT_SHA256: &str = "da23667da80ef5d3197f475961b16fa4bf9f49d0d43e89a8c63c50c3c9e6e797";

#[derive(Debug, Deserialize)]
struct SourcePinnedEnrollment {
    schema_version: String,
    enrollment_id: String,
    production_status: String,
    synthetic: bool,
    verifier: SourcePinnedVerifier,
}

#[derive(Debug, Deserialize)]
struct SourcePinnedVerifier {
    principal: String,
    key_id: String,
    spki_der_base64: String,
    spki_der_sha256: String,
}

#[derive(Debug)]
pub(crate) struct EnrollmentAdmission {
    pub(crate) inactive: bool,
    pub(crate) verifier_principal: String,
    pub(crate) verifier_key_id: String,
    pub(crate) verifier_spki_der_base64: String,
    pub(crate) verifier_spki_der_sha256: String,
}

/// This is deliberately a source pin, not a transport for caller-selected
/// authority metadata. The tracked #104 document is synthetic and inactive,
/// so it cannot create a production native-capability boundary.
pub(crate) fn source_pinned_admission(
    enrollment_id: &str,
    enrollment_sha256: &str,
) -> io::Result<EnrollmentAdmission> {
    if hex::encode(Sha256::digest(ENROLLMENT_BYTES)) != ENROLLMENT_SHA256
        || enrollment_sha256 != ENROLLMENT_SHA256
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "source-pinned #104 enrollment hash mismatch",
        ));
    }
    let enrollment: SourcePinnedEnrollment =
        serde_json::from_slice(ENROLLMENT_BYTES).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "source-pinned #104 enrollment is malformed",
            )
        })?;
    if enrollment.schema_version != "gate_h2_post_begin_authority_enrollment_v1.0.0"
        || enrollment.enrollment_id != enrollment_id
        || enrollment.verifier.principal.is_empty()
        || enrollment.verifier.key_id.is_empty()
        || enrollment.verifier.spki_der_base64.is_empty()
        || enrollment.verifier.spki_der_sha256.len() != 64
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "source-pinned #104 enrollment is not the inactive synthetic root",
        ));
    }
    Ok(EnrollmentAdmission {
        inactive: enrollment.production_status == "inactive" && enrollment.synthetic,
        verifier_principal: enrollment.verifier.principal,
        verifier_key_id: enrollment.verifier.key_id,
        verifier_spki_der_base64: enrollment.verifier.spki_der_base64,
        verifier_spki_der_sha256: enrollment.verifier.spki_der_sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inactive_source_pin_rejects_all_external_admission() {
        let admission = source_pinned_admission(
            "gate_h2_authority_enrollment_synthetic_v1",
            ENROLLMENT_SHA256,
        )
        .unwrap();
        assert!(admission.inactive);
    }

    #[test]
    fn copied_or_wrong_enrollment_labels_do_not_admit() {
        for (id, digest) in [
            ("copied-public-label", ENROLLMENT_SHA256),
            ("gate_h2_authority_enrollment_synthetic_v1", &"0".repeat(64)),
        ] {
            assert!(source_pinned_admission(id, digest).is_err());
        }
    }
}
