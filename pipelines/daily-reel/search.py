"""Search the mtl-archives worker API for images."""
import os
import requests
from typing import Optional

def _get_worker_url() -> str:
    """Use the project API domain, with explicit development overrides."""
    return (os.environ.get("API_BASE") or os.environ.get("MTL_API_BASE")
            or "https://api.mtlarchives.com").rstrip("/")


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
    if record.get("portalMatch") is not None:
        parts.append(f"Portal Match: {record['portalMatch']}")
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
    if record.get("metadataFilename"):
        parts.append(f"Metadata Filename: {record['metadataFilename']}")
    if record.get("filename"):
        parts.append(f"Image Filename: {record['filename']}")
    if record.get("credits"):
        parts.append(f"Credits: {record['credits']}")
    if record.get("cote"):
        parts.append(f"Archival Reference: {record['cote']}")
    if record.get("ocrText"):
        parts.append(f"OCR Text: {record['ocrText'][:500]}")
    if record.get("latitude") and record.get("longitude"):
        parts.append(f"Location: {record['latitude']}, {record['longitude']}")
    return "\n".join(parts) if parts else ""
