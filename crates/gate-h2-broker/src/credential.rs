use std::{
    io::{self, Read},
    os::fd::{FromRawFd, OwnedFd, RawFd},
};

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

pub const MAX_SECRET_BYTES: usize = 64 * 1024;

#[derive(Zeroize)]
#[zeroize(drop)]
pub struct SecretBytes(Vec<u8>);

impl SecretBytes {
    pub fn from_sealed_inherited_fd(
        fd: RawFd,
        expected_commitment: &str,
        expected_bytes: usize,
    ) -> io::Result<Self> {
        if expected_bytes == 0 || expected_bytes > MAX_SECRET_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid secret descriptor bound",
            ));
        }
        validate_sealed_memfd(fd)?;
        let owned = unsafe { OwnedFd::from_raw_fd(fd) };
        let mut file = std::fs::File::from(owned);
        let mut bytes = Zeroizing::new(Vec::with_capacity(expected_bytes.min(4096)));
        let mut chunk = Zeroizing::new([0_u8; 4096]);
        loop {
            let read = file.read(&mut *chunk)?;
            if read == 0 {
                break;
            }
            if bytes
                .len()
                .checked_add(read)
                .is_none_or(|size| size > expected_bytes)
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "secret descriptor exceeds bound",
                ));
            }
            bytes.extend_from_slice(&chunk[..read]);
            chunk[..read].zeroize();
        }
        if bytes.len() != expected_bytes {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "secret descriptor length mismatch",
            ));
        }
        if bytes.is_empty()
            || bytes
                .iter()
                .any(|byte| *byte == 0 || byte.is_ascii_control())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "secret descriptor contains forbidden bytes",
            ));
        }
        let expected = hex::decode(expected_commitment).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid secret commitment")
        })?;
        let actual = Sha256::digest(&*bytes);
        if expected.len() != actual.len() || expected.ct_eq(actual.as_slice()).unwrap_u8() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "secret commitment mismatch",
            ));
        }
        Ok(Self(std::mem::take(&mut *bytes)))
    }

    #[cfg(test)]
    pub(crate) fn for_test(bytes: &[u8]) -> Self {
        Self(bytes.to_vec())
    }

    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

#[cfg(target_os = "linux")]
fn validate_sealed_memfd(fd: RawFd) -> io::Result<()> {
    let seals = unsafe { libc::fcntl(fd, libc::F_GET_SEALS) };
    let required = libc::F_SEAL_SEAL | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_WRITE;
    if seals < 0 || seals & required != required {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret descriptor is not a fully sealed memfd",
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn validate_sealed_memfd(_: RawFd) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "sealed inherited descriptors require Linux",
    ))
}

impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBytes([REDACTED])")
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::{
        ffi::CString,
        io::Write,
        os::fd::{AsRawFd, IntoRawFd},
    };

    fn memfd(bytes: &[u8], seal: bool) -> RawFd {
        let name = CString::new("gate-h2-secret-test").unwrap();
        let fd = unsafe {
            libc::memfd_create(name.as_ptr(), libc::MFD_ALLOW_SEALING | libc::MFD_CLOEXEC)
        };
        assert!(fd >= 0);
        let owned = unsafe { OwnedFd::from_raw_fd(fd) };
        let mut file = std::fs::File::from(owned);
        file.write_all(bytes).unwrap();
        file.flush().unwrap();
        unsafe { libc::lseek(file.as_raw_fd(), 0, libc::SEEK_SET) };
        if seal {
            let seals =
                libc::F_SEAL_SEAL | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_WRITE;
            assert_eq!(
                unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, seals) },
                0
            );
        }
        file.into_raw_fd()
    }

    #[test]
    fn production_secret_reader_requires_all_memfd_seals() {
        let bytes = b"fixture-secret";
        let commitment = hex::encode(Sha256::digest(bytes));
        let secret =
            SecretBytes::from_sealed_inherited_fd(memfd(bytes, true), &commitment, bytes.len())
                .unwrap();
        assert_eq!(secret.expose(), bytes);
        assert!(
            SecretBytes::from_sealed_inherited_fd(memfd(bytes, false), &commitment, bytes.len())
                .is_err()
        );
    }

    #[test]
    fn production_secret_reader_enforces_exact_length() {
        let bytes = b"fixture-secret";
        let commitment = hex::encode(Sha256::digest(bytes));
        assert!(
            SecretBytes::from_sealed_inherited_fd(
                memfd(bytes, true),
                &commitment,
                bytes.len() - 1,
            )
            .is_err()
        );
        assert!(
            SecretBytes::from_sealed_inherited_fd(
                memfd(bytes, true),
                &commitment,
                bytes.len() + 1,
            )
            .is_err()
        );
    }

    #[test]
    fn production_signing_key_representation_passes_sealed_memfd_reader() {
        let bytes = b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        assert_eq!(bytes.len(), crate::evidence::SIGNING_KEY_BASE64URL_BYTES);
        let commitment = hex::encode(Sha256::digest(bytes));
        let secret = SecretBytes::from_sealed_inherited_fd(
            memfd(bytes, true),
            &commitment,
            crate::evidence::SIGNING_KEY_BASE64URL_BYTES,
        )
        .unwrap();
        assert_eq!(
            secret.expose().len(),
            crate::evidence::SIGNING_KEY_BASE64URL_BYTES
        );
    }
}
