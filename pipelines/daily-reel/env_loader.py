from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _parse_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _canonical_repo_root(repo_root: Path) -> Path | None:
    configured = os.environ.get("MTL_ARCHIVES_PRIMARY_REPO", "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        if path.exists():
            return path

    try:
        common_dir = subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=repo_root,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None

    if not common_dir:
        return None

    common_path = Path(common_dir)
    if not common_path.is_absolute():
        common_path = (repo_root / common_path).resolve()

    if common_path.name == ".git":
        candidate = common_path.parent
        return candidate if candidate.exists() else None
    return None


def load_repo_env(repo_root: Path) -> None:
    roots: list[Path] = []
    seen: set[str] = set()

    for candidate in (repo_root.resolve(), _canonical_repo_root(repo_root)):
        if candidate is None:
            continue
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        roots.append(candidate)

    for root in roots:
        for env_name in (".env.local", ".env"):
            _parse_env_file(root / env_name)
