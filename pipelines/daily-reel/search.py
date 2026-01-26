"""Search the mtl-archives worker API for images."""
import os
import subprocess
import requests
from pathlib import Path
from typing import Optional

# Resolve worker URL from wrangler.toml in the monorepo
REPO_ROOT = Path(__file__).resolve().parents[2]
WRANGLER_TOML = REPO_ROOT / "apps" / "api" / "wrangler.toml"


def _get_worker_url() -> str:
    """Derive the worker URL from wrangler.toml + account subdomain."""
    # Parse worker name from wrangler.toml
    worker_name = None
    with open(WRANGLER_TOML) as f:
        for line in f:
            if line.strip().startswith("name"):
                worker_name = line.split("=")[1].strip().strip('"')
                break

    if not worker_name:
        raise RuntimeError(f"Could not parse worker name from {WRANGLER_TOML}")

    # Get account subdomain via wrangler whoami
    subdomain = os.environ.get("WORKERS_SUBDOMAIN")
    if not subdomain:
        try:
            result = subprocess.run(
                ["wrangler", "whoami"],
                capture_output=True, text=True, timeout=10,
                cwd=REPO_ROOT / "apps" / "api",
            )
            # Parse subdomain from output (format: "...workers.dev subdomain: xxx")
            for line in result.stdout.splitlines():
                if "workers.dev" in line.lower() and "subdomain" in line.lower():
                    subdomain = line.split(":")[-1].strip()
                    break
            # Fallback: look for account name pattern
            if not subdomain:
                for line in result.stdout.splitlines():
                    if ".workers.dev" in line:
                        # Extract subdomain from URL pattern
                        parts = line.split(".workers.dev")[0].split(".")
                        if len(parts) > 1:
                            subdomain = parts[-1]
                            break
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    if not subdomain:
        # Final fallback: use account subdomain from env or default
        subdomain = "wiel"

    return f"https://{worker_name}.{subdomain}.workers.dev"


# Cache the URL at module level
API_BASE = _get_worker_url()


def search_images(query: str, mode: str = "smart", limit: int = 10) -> list[dict]:
    """Search for images using the worker API."""
    resp = requests.get(
        f"{API_BASE}/api/search",
        params={"q": query, "mode": mode, "limit": limit},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("items", [])


def get_random_images(limit: int = 10, max_size: Optional[int] = None) -> list[dict]:
    """Get random images for discovery."""
    params = {"limit": limit, "shuffle": "true"}
    if max_size:
        params["maxSize"] = max_size
    resp = requests.get(f"{API_BASE}/api/photos", params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("items", [])


def get_photo_by_id(photo_id: str) -> Optional[dict]:
    """Fetch a specific photo by its metadata_filename."""
    resp = requests.get(
        f"{API_BASE}/api/photos",
        params={"id": photo_id},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    items = data.get("items", [])
    return items[0] if items else None


def download_image(url: str, output_path: str) -> str:
    """Download an image from a URL to a local path."""
    resp = requests.get(url, timeout=60, stream=True)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    return output_path


def format_metadata(record: dict) -> str:
    """Format D1 metadata for use as research context."""
    parts = []
    if record.get("name"):
        parts.append(f"Title: {record['name']}")
    if record.get("description"):
        parts.append(f"Description: {record['description']}")
    if record.get("portalTitle"):
        parts.append(f"Official Title: {record['portalTitle']}")
    if record.get("portalDescription"):
        parts.append(f"Official Description: {record['portalDescription']}")
    if record.get("dateValue"):
        parts.append(f"Date: {record['dateValue']}")
    if record.get("credits"):
        parts.append(f"Credits: {record['credits']}")
    if record.get("cote"):
        parts.append(f"Archival Reference: {record['cote']}")
    if record.get("ocrText"):
        parts.append(f"OCR Text: {record['ocrText'][:500]}")
    if record.get("latitude") and record.get("longitude"):
        parts.append(f"Location: {record['latitude']}, {record['longitude']}")
    return "\n".join(parts) if parts else ""
