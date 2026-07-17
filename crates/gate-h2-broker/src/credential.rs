use std::{
    io::{self, Read},
    os::fd::{FromRawFd, RawFd},
};

use sha2::{Digest, Sha256};

pub struct SecretBytes(Vec<u8>);

impl SecretBytes {
    pub fn from_inherited_fd(
        fd: RawFd,
        expected_commitment: &str,
        require_sealed: bool,
    ) -> io::Result<Self> {
        #[cfg(target_os = "linux")]
        if require_sealed {
            let seals = unsafe { libc::fcntl(fd, libc::F_GET_SEALS) };
            let required =
                libc::F_SEAL_SEAL | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_WRITE;
            if seals < 0 || seals & required != required {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "credential descriptor is not sealed",
                ));
            }
        }
        #[cfg(not(target_os = "linux"))]
        if require_sealed {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "sealed descriptor verification requires Linux",
            ));
        }
        let file = unsafe { std::fs::File::from_raw_fd(fd) };
        let mut bytes = Vec::new();
        file.take(64 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.is_empty() || bytes.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid credential descriptor length",
            ));
        }
        let commitment = hex::encode(Sha256::digest(&bytes));
        if commitment != expected_commitment {
            bytes.fill(0);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "credential commitment mismatch",
            ));
        }
        Ok(Self(bytes))
    }
    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBytes([REDACTED])")
    }
}
