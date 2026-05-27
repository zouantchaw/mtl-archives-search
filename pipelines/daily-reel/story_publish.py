#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import requests

from token_manager import DEFAULT_STATE_PATH, _load_state


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG_PATH = Path(
    os.environ.get("MTL_STORY_PUBLISH_LOG", str(REPO_ROOT / "data" / "social" / "story-publish-log.jsonl"))
).expanduser()
GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v25.0")
DEFAULT_R2_PUBLIC_DOMAIN = os.environ.get("CLOUDFLARE_R2_PUBLIC_DOMAIN", "").strip()
DEFAULT_R2_ACCOUNT_ID = (
    os.environ.get("CLOUDFLARE_R2_ACCOUNT_ID", "").strip()
    or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
)
DEFAULT_R2_BUCKET = os.environ.get("CLOUDFLARE_R2_BUCKET", "").strip()
DEFAULT_R2_ACCESS_KEY = os.environ.get("CLOUDFLARE_R2_ACCESS_KEY", "").strip()
DEFAULT_R2_SECRET_ACCESS_KEY = os.environ.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "").strip()


class StoryPublishError(RuntimeError):
    pass


@dataclass
class StoryContext:
    user_token: str
    page_token: str
    page_id: str
    page_name: str
    ig_id: str
    ig_username: str
    scopes: set[str]


def _iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fail(message: str) -> None:
    raise SystemExit(message)


def _load_context(state_path: Path) -> StoryContext:
    state = _load_state(state_path)
    user_token = str(((state.get("user_token") or {}).get("access_token")) or "").strip()
    page_token = str(((state.get("page") or {}).get("access_token")) or "").strip()
    page_id = str(((state.get("page") or {}).get("id")) or "").strip()
    page_name = str(((state.get("page") or {}).get("name")) or "").strip()
    ig_id = str(((state.get("instagram") or {}).get("id")) or "").strip()
    ig_username = str(((state.get("instagram") or {}).get("username")) or "").strip()
    scopes = {
        str(item.get("permission") or "").strip()
        for item in (state.get("permissions") or [])
        if str(item.get("status") or "").strip().lower() == "granted"
    }
    if not user_token or not page_token or not page_id:
        _fail(f"Meta token state is incomplete in {state_path}")
    return StoryContext(
        user_token=user_token,
        page_token=page_token,
        page_id=page_id,
        page_name=page_name,
        ig_id=ig_id,
        ig_username=ig_username,
        scopes=scopes,
    )


def _append_log(log_path: Path, entry: dict[str, Any]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _r2_required(value: str, label: str) -> str:
    if value.strip():
        return value.strip()
    _fail(
        f"Missing {label}. Add it to .env.local/.env or pass a public URL instead of a local file."
    )


def _encode_path_component(value: str) -> str:
    return quote(value, safe="/~")


def _encode_rfc3986(value: str) -> str:
    return quote(value, safe="-_.~")


def _hmac_sha256(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _sha256_hex(message: str) -> str:
    return hashlib.sha256(message.encode("utf-8")).hexdigest()


def _to_amz_date(now: datetime) -> str:
    return now.strftime("%Y%m%dT%H%M%SZ")


def _presign_r2_url(*, key: str, method: str, expires_in: int) -> str:
    access_key = _r2_required(DEFAULT_R2_ACCESS_KEY, "CLOUDFLARE_R2_ACCESS_KEY")
    secret_key = _r2_required(DEFAULT_R2_SECRET_ACCESS_KEY, "CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    account_id = _r2_required(DEFAULT_R2_ACCOUNT_ID, "CLOUDFLARE_R2_ACCOUNT_ID")
    bucket = _r2_required(DEFAULT_R2_BUCKET, "CLOUDFLARE_R2_BUCKET")

    service = "s3"
    region = "auto"
    host = f"{account_id}.r2.cloudflarestorage.com"
    canonical_uri = f"/{_encode_path_component(bucket)}/{_encode_path_component(key)}"

    now = datetime.now(UTC)
    amz_date = _to_amz_date(now)
    date_stamp = amz_date[:8]
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    credential = f"{access_key}/{credential_scope}"

    query_params = [
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
        ("X-Amz-Credential", credential),
        ("X-Amz-Date", amz_date),
        ("X-Amz-Expires", str(expires_in)),
        ("X-Amz-SignedHeaders", "host"),
    ]

    canonical_query = "&".join(
        f"{_encode_rfc3986(key_name)}={_encode_rfc3986(value)}"
        for key_name, value in sorted(query_params, key=lambda item: item[0])
    )
    canonical_headers = f"host:{host}\n"
    signed_headers = "host"
    payload_hash = "UNSIGNED-PAYLOAD"
    canonical_request = (
        f"{method}\n{canonical_uri}\n{canonical_query}\n"
        f"{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )
    hashed_canonical_request = _sha256_hex(canonical_request)
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{hashed_canonical_request}"
    )

    k_date = _hmac_sha256(f"AWS4{secret_key}".encode("utf-8"), date_stamp)
    k_region = hmac.new(k_date, region.encode("utf-8"), hashlib.sha256).digest()
    k_service = hmac.new(k_region, service.encode("utf-8"), hashlib.sha256).digest()
    signing_key = hmac.new(k_service, b"aws4_request", hashlib.sha256).digest()
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return f"https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def _upload_file_to_r2(*, local_path: Path, object_key: str) -> str:
    signed_url = _presign_r2_url(key=object_key, method="PUT", expires_in=3600)
    content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    with local_path.open("rb") as fh:
        response = requests.put(
            signed_url,
            data=fh,
            headers={"Content-Type": content_type},
            timeout=120,
        )
    if response.status_code not in {200, 201}:
        raise StoryPublishError(
            f"R2 upload failed for {local_path.name}: HTTP {response.status_code} {response.text[:400]}"
        )
    public_domain = _r2_required(DEFAULT_R2_PUBLIC_DOMAIN, "CLOUDFLARE_R2_PUBLIC_DOMAIN")
    return f"https://{public_domain}/{_encode_path_component(object_key)}"


def _graph_get(path: str, *, params: dict[str, str]) -> dict[str, Any]:
    response = requests.get(
        f"https://graph.facebook.com/{GRAPH_VERSION}/{path}",
        params=params,
        timeout=30,
    )
    payload = response.json()
    if response.status_code >= 400 or payload.get("error"):
        error = payload.get("error") or {}
        raise StoryPublishError(
            f"Graph GET {path} failed: {error.get('message') or payload}"
        )
    return payload


def _graph_post(path: str, *, data: dict[str, str]) -> dict[str, Any]:
    response = requests.post(
        f"https://graph.facebook.com/{GRAPH_VERSION}/{path}",
        data=data,
        timeout=60,
    )
    payload = response.json()
    if response.status_code >= 400 or payload.get("error"):
        error = payload.get("error") or {}
        raise StoryPublishError(
            f"Graph POST {path} failed: {error.get('message') or payload}"
        )
    return payload


def _post_json_url(url: str, *, data: dict[str, str], headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.post(url, data=data, headers=headers or {}, timeout=120)
    try:
        payload = response.json()
    except ValueError:
        payload = {"text": response.text}
    if response.status_code >= 400 or payload.get("error"):
        error = payload.get("error") or {}
        raise StoryPublishError(
            f"HTTP POST {url} failed: {error.get('message') or payload}"
        )
    return payload


def _post_binary_url(
    url: str,
    *,
    local_path: Path,
    headers: dict[str, str] | None = None,
    timeout: int = 300,
) -> dict[str, Any]:
    with local_path.open("rb") as fh:
        response = requests.post(url, data=fh, headers=headers or {}, timeout=timeout)
    try:
        payload = response.json()
    except ValueError:
        payload = {"text": response.text}
    if response.status_code >= 400 or payload.get("error"):
        error = payload.get("error") or {}
        raise StoryPublishError(
            f"HTTP POST {url} failed: {error.get('message') or payload}"
        )
    return payload


def _poll_ig_container(*, creation_id: str, access_token: str, timeout_seconds: int, poll_interval: int) -> dict[str, Any]:
    deadline = datetime.now(UTC).timestamp() + timeout_seconds
    last_payload: dict[str, Any] | None = None
    while datetime.now(UTC).timestamp() < deadline:
        payload = _graph_get(
            creation_id,
            params={
                "access_token": access_token,
                "fields": "id,status_code,status",
            },
        )
        last_payload = payload
        status_code = str(payload.get("status_code") or "").upper()
        if status_code in {"FINISHED", "PUBLISHED"}:
            return payload
        if status_code in {"ERROR", "EXPIRED"}:
            raise StoryPublishError(f"Instagram Story container {creation_id} ended in {status_code}")
        import time

        time.sleep(poll_interval)
    raise StoryPublishError(
        f"Timed out waiting for Instagram Story container {creation_id}. Last status: {last_payload}"
    )


def _default_r2_key(*, local_path: Path, prefix: str) -> str:
    date_dir = datetime.now(UTC).strftime("%Y-%m-%d")
    safe_name = local_path.name.replace(" ", "-")
    return f"{prefix.rstrip('/')}/{date_dir}/{safe_name}"


def _facebook_story_supported(context: StoryContext) -> bool:
    return bool(context.page_id and context.page_token and "pages_manage_posts" in context.scopes)


def _build_summary(result: dict[str, Any]) -> str:
    lines = []
    mode = result.get("mode") or "unknown"
    if mode == "status":
        lines.append("Story publishing capability check is ready.")
        lines.append(f"- Instagram Story publishing: `{result['instagram']['publish_supported']}`")
        lines.append(f"- Facebook Page Story publishing: `{result['facebook']['publish_supported']}`")
        lines.append(f"- IG account: `{result['instagram']['username']}` (`{result['instagram']['id']}`)")
        lines.append(f"- Facebook Page: `{result['facebook']['name']}` (`{result['facebook']['id']}`)")
        lines.append("Limitations:")
        for item in result.get("limitations") or []:
            lines.append(f"- {item}")
        return "\n".join(lines)

    if result.get("platform") == "instagram":
        action = "prepared" if result.get("prepare_only") else "published"
        lines.append(f"Instagram Story is {action}.")
        lines.append(f"- Local asset: {result.get('local_asset')}")
        lines.append(f"- Public media URL: {result.get('public_media_url')}")
        lines.append(f"- R2 object key: `{result.get('r2_object_key')}`")
        lines.append(f"- Story container: `{result.get('creation_id')}`")
        if result.get("container_status"):
            lines.append(f"- Container status: `{result.get('container_status')}`")
        if result.get("published_media_id"):
            lines.append(f"- Published media ID: `{result.get('published_media_id')}`")
        if result.get("permalink"):
            lines.append(f"- Story permalink: {result.get('permalink')}")
        lines.append("Limitations:")
        lines.append("- Instagram server-side Story publishing does not support stickers like link, poll, or location.")
        lines.append("- Your usual clickable `DEFI DU JOUR` link cannot be added through this API path.")
        lines.append("- If you need a clickable link sticker, you still need a mobile Share-to-Stories workflow or a manual app step.")
        return "\n".join(lines)

    if result.get("platform") == "facebook":
        action = "prepared" if result.get("prepare_only") else "published"
        lines.append(f"Facebook Page Story is {action}.")
        lines.append(f"- Local asset: {result.get('local_asset')}")
        lines.append(f"- Public media URL: {result.get('public_media_url')}")
        lines.append(f"- R2 object key: `{result.get('r2_object_key')}`")
        lines.append(f"- Page Story video ID: `{result.get('video_id')}`")
        if result.get("post_id"):
            lines.append(f"- Story post ID: `{result.get('post_id')}`")
        lines.append("Limitations:")
        lines.append("- Facebook Page Story publishing here supports generated video assets only.")
        lines.append("- Server-side publishing does not add link, poll, or location stickers.")
        return "\n".join(lines)

    return json.dumps(result, indent=2, ensure_ascii=False)


def status_command(*, state_path: Path) -> dict[str, Any]:
    context = _load_context(state_path)
    limitations = [
        "Instagram server-side Story publishing does not support stickers like link, poll, or location.",
        "Facebook Page Story publishing supports generated video assets; stickers still require a manual/mobile step.",
    ]
    return {
        "mode": "status",
        "instagram": {
            "id": context.ig_id,
            "username": context.ig_username,
            "publish_supported": bool(context.ig_id and "instagram_content_publish" in context.scopes),
        },
        "facebook": {
            "id": context.page_id,
            "name": context.page_name,
            "publish_supported": _facebook_story_supported(context),
        },
        "limitations": limitations,
    }


def publish_instagram_story(
    *,
    story_path: Path,
    state_path: Path,
    log_path: Path,
    prepare_only: bool,
    object_key: str | None,
    media_url: str | None,
    timeout_seconds: int,
    poll_interval: int,
    link_url: str | None,
) -> dict[str, Any]:
    context = _load_context(state_path)
    if "instagram_content_publish" not in context.scopes:
        _fail("The stored Meta token is missing instagram_content_publish")
    if not context.ig_id:
        _fail("No Instagram business account is linked in the stored Meta token state")
    if link_url:
        _fail(
            "Instagram server-side Story publishing does not support link stickers. "
            "Remove --link-url or use a mobile Share-to-Stories flow instead."
        )

    if media_url:
        public_media_url = media_url.strip()
        r2_object_key = None
    else:
        if not story_path.exists():
            _fail(f"Story asset does not exist: {story_path}")
        resolved_object_key = object_key or _default_r2_key(local_path=story_path, prefix="social-stories/instagram")
        public_media_url = _upload_file_to_r2(local_path=story_path, object_key=resolved_object_key)
        r2_object_key = resolved_object_key

    payload = _graph_post(
        f"{context.ig_id}/media",
        data={
            "access_token": context.user_token,
            "media_type": "STORIES",
            "video_url": public_media_url,
        },
    )
    creation_id = str(payload.get("id") or "").strip()
    if not creation_id:
        raise StoryPublishError("Instagram Story container creation did not return an id")
    container = _poll_ig_container(
        creation_id=creation_id,
        access_token=context.user_token,
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
    )
    result: dict[str, Any] = {
        "mode": "publish",
        "platform": "instagram",
        "prepare_only": prepare_only,
        "local_asset": str(story_path),
        "public_media_url": public_media_url,
        "r2_object_key": r2_object_key,
        "creation_id": creation_id,
        "container_status": container.get("status_code"),
        "created_at": _iso_now(),
    }

    if not prepare_only:
        publish = _graph_post(
            f"{context.ig_id}/media_publish",
            data={
                "access_token": context.user_token,
                "creation_id": creation_id,
            },
        )
        published_media_id = str(publish.get("id") or "").strip()
        result["published_media_id"] = published_media_id
        if published_media_id:
            media = _graph_get(
                published_media_id,
                params={
                    "access_token": context.user_token,
                    "fields": "id,media_type,permalink,timestamp",
                },
            )
            result["permalink"] = media.get("permalink")
            result["timestamp"] = media.get("timestamp")
            result["media_type"] = media.get("media_type")
        result["published_at"] = _iso_now()

    _append_log(
        log_path,
        {
            "recorded_at": _iso_now(),
            **result,
        },
    )
    return result


def publish_facebook_story(
    *,
    story_path: Path,
    state_path: Path,
    log_path: Path,
    prepare_only: bool,
    object_key: str | None,
    media_url: str | None,
    link_url: str | None,
) -> dict[str, Any]:
    context = _load_context(state_path)
    if not _facebook_story_supported(context):
        _fail("The stored Meta token is missing Facebook Page Story publishing support")
    if link_url:
        _fail(
            "Facebook server-side Story publishing does not support link stickers here. "
            "Remove --link-url or use a mobile/manual workflow instead."
        )

    if media_url:
        public_media_url = media_url.strip()
        r2_object_key = None
    else:
        if not story_path.exists():
            _fail(f"Story asset does not exist: {story_path}")
        resolved_object_key = object_key or _default_r2_key(local_path=story_path, prefix="social-stories/facebook")
        public_media_url = _upload_file_to_r2(local_path=story_path, object_key=resolved_object_key)
        r2_object_key = resolved_object_key

    start = _graph_post(
        f"{context.page_id}/video_stories",
        data={
            "access_token": context.page_token,
            "upload_phase": "start",
        },
    )
    video_id = str(start.get("video_id") or "").strip()
    upload_url = str(start.get("upload_url") or "").strip()
    if not video_id or not upload_url:
        raise StoryPublishError(f"Facebook Story upload start did not return video_id/upload_url: {start}")

    upload = _post_binary_url(
        upload_url,
        local_path=story_path,
        headers={
            "Authorization": f"OAuth {context.page_token}",
            "offset": "0",
            "file_size": str(story_path.stat().st_size),
            "Content-Type": "application/octet-stream",
        },
    )
    result: dict[str, Any] = {
        "mode": "publish",
        "platform": "facebook",
        "prepare_only": prepare_only,
        "local_asset": str(story_path),
        "public_media_url": public_media_url,
        "r2_object_key": r2_object_key,
        "video_id": video_id,
        "upload_result": upload,
        "created_at": _iso_now(),
    }

    if not prepare_only:
        finish = _graph_post(
            f"{context.page_id}/video_stories",
            data={
                "access_token": context.page_token,
                "upload_phase": "finish",
                "video_id": video_id,
            },
        )
        result["finish_result"] = finish
        result["post_id"] = finish.get("post_id") or finish.get("id")
        result["published_at"] = _iso_now()

    _append_log(
        log_path,
        {
            "recorded_at": _iso_now(),
            **result,
        },
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publish or inspect MTL Archives social Story capabilities using persisted Meta auth."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Report current Story publishing capabilities")
    status_parser.add_argument(
        "--state-path",
        default=str(DEFAULT_STATE_PATH),
        help=f"Meta token state path (default: {DEFAULT_STATE_PATH})",
    )
    status_parser.add_argument("--json", action="store_true", help="Print raw JSON instead of operator summary")

    publish_parser = subparsers.add_parser("publish", help="Publish an Instagram or Facebook Page Story from a local video or public URL")
    publish_parser.add_argument(
        "--platform",
        choices=["instagram", "facebook"],
        default="instagram",
        help="Story destination.",
    )
    publish_parser.add_argument("--story-path", help="Local video asset to upload and publish")
    publish_parser.add_argument("--media-url", help="Existing public media URL to publish instead of uploading a local file")
    publish_parser.add_argument("--object-key", help="Optional R2 object key override when uploading a local file")
    publish_parser.add_argument("--link-url", help="Requested click-through URL. Server-side Stories do not support this.")
    publish_parser.add_argument("--prepare-only", action="store_true", help="Stop after upload + validated container creation; do not publish live")
    publish_parser.add_argument("--timeout-seconds", type=int, default=180, help="Container polling timeout in seconds")
    publish_parser.add_argument("--poll-interval", type=int, default=5, help="Container polling interval in seconds")
    publish_parser.add_argument(
        "--state-path",
        default=str(DEFAULT_STATE_PATH),
        help=f"Meta token state path (default: {DEFAULT_STATE_PATH})",
    )
    publish_parser.add_argument(
        "--log-path",
        default=str(DEFAULT_LOG_PATH),
        help=f"Story publish log path (default: {DEFAULT_LOG_PATH})",
    )
    publish_parser.add_argument("--json", action="store_true", help="Print raw JSON instead of operator summary")

    args = parser.parse_args()

    if args.command == "status":
        result = status_command(state_path=Path(args.state_path).expanduser())
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(_build_summary(result))
        return

    if not args.story_path and not args.media_url:
        _fail("Provide either --story-path or --media-url")
    story_path = Path(args.story_path).expanduser().resolve() if args.story_path else Path(".")
    if args.platform == "facebook":
        result = publish_facebook_story(
            story_path=story_path,
            state_path=Path(args.state_path).expanduser(),
            log_path=Path(args.log_path).expanduser(),
            prepare_only=bool(args.prepare_only),
            object_key=args.object_key,
            media_url=args.media_url,
            link_url=args.link_url,
        )
    else:
        result = publish_instagram_story(
            story_path=story_path,
            state_path=Path(args.state_path).expanduser(),
            log_path=Path(args.log_path).expanduser(),
            prepare_only=bool(args.prepare_only),
            object_key=args.object_key,
            media_url=args.media_url,
            timeout_seconds=int(args.timeout_seconds),
            poll_interval=int(args.poll_interval),
            link_url=args.link_url,
        )
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(_build_summary(result))


if __name__ == "__main__":
    try:
        main()
    except StoryPublishError as exc:
        _fail(str(exc))
