#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from env_loader import load_repo_env

REPO_ROOT = Path(__file__).resolve().parents[2]
load_repo_env(REPO_ROOT)

DEFAULT_STATE_PATH = Path(
    os.environ.get("MTL_META_TOKEN_STATE", str(REPO_ROOT / "data" / "social" / "meta-token-state.json"))
).expanduser()
GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v25.0")
DEFAULT_APP_ID = os.environ.get("META_APP_ID", "").strip()
DEFAULT_APP_SECRET = os.environ.get("META_APP_SECRET", "").strip()
DEFAULT_SHORT_LIVED_USER_TOKEN = os.environ.get("META_SHORT_LIVED_USER_TOKEN", "").strip()
DEFAULT_PAGE_ID = os.environ.get("META_PAGE_ID", "").strip()


def _fail(message: str) -> None:
    raise SystemExit(message)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _iso_now() -> str:
    return _utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def _iso_from_unix(timestamp: int | float | None) -> str | None:
    if not timestamp:
        return None
    return datetime.fromtimestamp(float(timestamp), tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _graph_get(path: str, *, params: dict[str, str]) -> dict:
    url = f"https://graph.facebook.com/{GRAPH_VERSION}/{path}"
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}")
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    error = payload.get("error")
    if error:
        message = error.get("message") or json.dumps(error)
        _fail(f"Graph API error for {path}: {message}")
    return payload


def _oauth_exchange(*, app_id: str, app_secret: str, short_lived_token: str) -> dict:
    return _graph_get(
        "oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": short_lived_token,
        },
    )


def _debug_token(*, app_id: str, app_secret: str, input_token: str) -> dict:
    payload = _graph_get(
        "debug_token",
        params={
            "input_token": input_token,
            "access_token": f"{app_id}|{app_secret}",
        },
    )
    return payload.get("data") or {}


def _me_permissions(*, user_token: str) -> list[dict]:
    payload = _graph_get("me/permissions", params={"access_token": user_token})
    return payload.get("data") or []


def _me_accounts(*, user_token: str) -> list[dict]:
    payload = _graph_get(
        "me/accounts",
        params={
            "fields": "id,name,access_token",
            "access_token": user_token,
        },
    )
    return payload.get("data") or []


def _page_info(*, user_token: str, page_id: str) -> dict:
    return _graph_get(
        page_id,
        params={
            "fields": "id,name,instagram_business_account{id,username,name}",
            "access_token": user_token,
        },
    )


def _resolve_page(*, accounts: list[dict], requested_page_id: str | None) -> dict:
    if requested_page_id:
        for account in accounts:
            if str(account.get("id")) == requested_page_id:
                return account
        _fail(f"Requested page_id {requested_page_id} was not returned by /me/accounts")
    if not accounts:
        _fail("No Facebook Pages were returned by /me/accounts")
    return accounts[0]


def _load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _fail(f"Invalid JSON in state file {path}: {exc}")


def _state_app_id(path: Path) -> str:
    state = _load_state(path)
    return str(((state.get("app") or {}).get("id")) or "").strip()


def _resolve_required(*values: str | None, label: str, help_hint: str) -> str:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    _fail(f"Missing {label}. {help_hint}")


def _write_state(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _normalize_granular_scopes(items: list[dict] | list[str] | None) -> list[dict] | list[str]:
    if not items:
        return []
    if all(isinstance(item, str) for item in items):
        return sorted(str(item) for item in items)

    normalized: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            normalized.append({"scope": str(item)})
            continue
        normalized.append(
            {
                "scope": str(item.get("scope") or ""),
                "target_ids": sorted(str(value) for value in (item.get("target_ids") or [])),
            }
        )
    normalized.sort(key=lambda item: (item.get("scope") or "", ",".join(item.get("target_ids") or [])))
    return normalized


def _extract_page_tasks(page_debug: dict) -> list[str]:
    tasks: set[str] = set()
    for scope in page_debug.get("granular_scopes") or []:
        if isinstance(scope, dict) and str(scope.get("scope") or "") == "pages_show_list":
            for value in scope.get("target_ids") or []:
                tasks.add(str(value))
    return sorted(tasks)


def bootstrap_state(
    *,
    app_id: str,
    app_secret: str,
    short_lived_token: str,
    page_id: str | None,
    state_path: Path,
) -> dict:
    exchange = _oauth_exchange(app_id=app_id, app_secret=app_secret, short_lived_token=short_lived_token)
    long_lived_user_token = str(exchange.get("access_token") or "").strip()
    if not long_lived_user_token:
        _fail("Failed to exchange a long-lived user token")

    user_debug = _debug_token(app_id=app_id, app_secret=app_secret, input_token=long_lived_user_token)
    permissions = _me_permissions(user_token=long_lived_user_token)
    accounts = _me_accounts(user_token=long_lived_user_token)
    page = _resolve_page(accounts=accounts, requested_page_id=page_id)
    page_access_token = str(page.get("access_token") or "").strip()
    if not page_access_token:
        _fail(f"Page {page.get('id')} did not include an access token")

    page_info = _page_info(user_token=long_lived_user_token, page_id=str(page.get("id")))
    instagram_business = page_info.get("instagram_business_account") or {}
    page_debug = _debug_token(app_id=app_id, app_secret=app_secret, input_token=page_access_token)

    payload = {
        "updated_at": _iso_now(),
        "app": {
            "id": app_id,
        },
        "user_token": {
            "access_token": long_lived_user_token,
            "expires_in": exchange.get("expires_in"),
            "expires_at": _iso_from_unix(user_debug.get("expires_at")),
            "issued_at": _iso_from_unix(user_debug.get("issued_at")),
            "is_valid": bool(user_debug.get("is_valid")),
            "user_id": str(user_debug.get("user_id") or ""),
            "scopes": sorted(user_debug.get("scopes") or []),
            "granular_scopes": _normalize_granular_scopes(user_debug.get("granular_scopes") or []),
        },
        "page": {
            "id": str(page.get("id") or ""),
            "name": page.get("name"),
            "access_token": page_access_token,
            "tasks": _extract_page_tasks(page_debug),
        },
        "instagram": {
            "id": str(instagram_business.get("id") or ""),
            "username": instagram_business.get("username"),
            "name": instagram_business.get("name"),
        },
        "permissions": permissions,
        "debug": {
            "user_token": user_debug,
            "page_token": page_debug,
        },
    }
    _write_state(state_path, payload)
    return payload


def status_state(
    *,
    app_id: str,
    app_secret: str,
    state_path: Path,
) -> dict:
    state = _load_state(state_path)
    user_token = (((state.get("user_token") or {}).get("access_token")) or "").strip()
    if not user_token:
        _fail(f"No user token stored in {state_path}")

    page_token = (((state.get("page") or {}).get("access_token")) or "").strip()
    page_id = str(((state.get("page") or {}).get("id")) or "").strip()

    user_debug = _debug_token(app_id=app_id, app_secret=app_secret, input_token=user_token)
    permissions = _me_permissions(user_token=user_token)
    accounts = _me_accounts(user_token=user_token)
    page = _resolve_page(accounts=accounts, requested_page_id=page_id or None)
    page_info = _page_info(user_token=user_token, page_id=str(page.get("id")))

    refreshed_page_token = str(page.get("access_token") or "").strip() or page_token
    page_debug = _debug_token(app_id=app_id, app_secret=app_secret, input_token=refreshed_page_token)
    instagram_business = page_info.get("instagram_business_account") or {}

    state["updated_at"] = _iso_now()
    state["app"] = {"id": app_id}
    state["user_token"] = {
        "access_token": user_token,
        "expires_at": _iso_from_unix(user_debug.get("expires_at")),
        "issued_at": _iso_from_unix(user_debug.get("issued_at")),
        "is_valid": bool(user_debug.get("is_valid")),
        "user_id": str(user_debug.get("user_id") or ""),
        "scopes": sorted(user_debug.get("scopes") or []),
        "granular_scopes": _normalize_granular_scopes(user_debug.get("granular_scopes") or []),
    }
    state["page"] = {
        "id": str(page.get("id") or ""),
        "name": page.get("name"),
        "access_token": refreshed_page_token,
        "tasks": _extract_page_tasks(page_debug),
    }
    state["instagram"] = {
        "id": str(instagram_business.get("id") or ""),
        "username": instagram_business.get("username"),
        "name": instagram_business.get("name"),
    }
    state["permissions"] = permissions
    state["debug"] = {
        "user_token": user_debug,
        "page_token": page_debug,
    }
    _write_state(state_path, state)
    return state


def print_env(state: dict) -> str:
    lines = [
        f"META_APP_ID={((state.get('app') or {}).get('id')) or ''}",
        f"META_PAGE_ID={((state.get('page') or {}).get('id')) or ''}",
        f"META_IG_ACCOUNT_ID={((state.get('instagram') or {}).get('id')) or ''}",
        f"META_IG_USERNAME={((state.get('instagram') or {}).get('username')) or ''}",
        f"META_USER_ACCESS_TOKEN={((state.get('user_token') or {}).get('access_token')) or ''}",
        f"META_PAGE_ACCESS_TOKEN={((state.get('page') or {}).get('access_token')) or ''}",
        f"META_USER_TOKEN_EXPIRES_AT={((state.get('user_token') or {}).get('expires_at')) or ''}",
    ]
    return "\n".join(lines)


def _days_until(expiry: str | None) -> int | None:
    if not expiry:
        return None
    try:
        expires_at = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = expires_at - _utc_now()
    return int(delta.total_seconds() // 86400)


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage durable Meta access tokens for MTL Archives")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap_parser = subparsers.add_parser(
        "bootstrap",
        help="Exchange a short-lived user token into a long-lived user token and derive the page token",
    )
    bootstrap_parser.add_argument("--app-id")
    bootstrap_parser.add_argument("--app-secret")
    bootstrap_parser.add_argument("--short-token", help="Short-lived user token from Graph API Explorer or login flow")
    bootstrap_parser.add_argument("--page-id", help="Optional page id if more than one page is returned")
    bootstrap_parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    bootstrap_parser.add_argument("--print-env", action="store_true", help="Also print shell-friendly env lines")

    status_parser = subparsers.add_parser(
        "status",
        help="Validate the stored user/page tokens, refresh page linkage, and print expiry status",
    )
    status_parser.add_argument("--app-id")
    status_parser.add_argument("--app-secret")
    status_parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    status_parser.add_argument("--warn-days", type=int, default=14, help="Warn when the user token expires within this many days")
    status_parser.add_argument("--print-env", action="store_true", help="Also print shell-friendly env lines")

    args = parser.parse_args()
    state_path = Path(args.state_path).expanduser()

    if args.command == "bootstrap":
        app_id = _resolve_required(
            args.app_id,
            DEFAULT_APP_ID,
            label="Meta app id",
            help_hint="Set META_APP_ID in .env.local/.env or pass --app-id.",
        )
        app_secret = _resolve_required(
            args.app_secret,
            DEFAULT_APP_SECRET,
            label="Meta app secret",
            help_hint="Set META_APP_SECRET in .env.local/.env or pass --app-secret.",
        )
        short_token = _resolve_required(
            args.short_token,
            DEFAULT_SHORT_LIVED_USER_TOKEN,
            label="short-lived Meta user token",
            help_hint="Set META_SHORT_LIVED_USER_TOKEN in .env.local/.env or pass --short-token.",
        )
        payload = bootstrap_state(
            app_id=app_id,
            app_secret=app_secret,
            short_lived_token=short_token,
            page_id=args.page_id or DEFAULT_PAGE_ID or None,
            state_path=state_path,
        )
        result = {
            "state_path": str(state_path),
            "page_id": ((payload.get("page") or {}).get("id")) or None,
            "instagram_account_id": ((payload.get("instagram") or {}).get("id")) or None,
            "instagram_username": ((payload.get("instagram") or {}).get("username")) or None,
            "user_token_expires_at": ((payload.get("user_token") or {}).get("expires_at")) or None,
            "permissions": [
                row.get("permission")
                for row in payload.get("permissions") or []
                if row.get("status") == "granted"
            ],
        }
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.print_env:
            print("\n# env")
            print(print_env(payload))
        return

    if args.command == "status":
        app_id = _resolve_required(
            args.app_id,
            DEFAULT_APP_ID,
            _state_app_id(state_path),
            label="Meta app id",
            help_hint="Set META_APP_ID in .env.local/.env, bootstrap first, or pass --app-id.",
        )
        app_secret = _resolve_required(
            args.app_secret,
            DEFAULT_APP_SECRET,
            label="Meta app secret",
            help_hint="Set META_APP_SECRET in .env.local/.env or pass --app-secret.",
        )
        payload = status_state(
            app_id=app_id,
            app_secret=app_secret,
            state_path=state_path,
        )
        expiry = ((payload.get("user_token") or {}).get("expires_at")) or None
        days_until = _days_until(expiry)
        result = {
            "state_path": str(state_path),
            "user_token_is_valid": bool(((payload.get("user_token") or {}).get("is_valid"))),
            "user_token_expires_at": expiry,
            "user_token_days_until_expiry": days_until,
            "page_id": ((payload.get("page") or {}).get("id")) or None,
            "instagram_account_id": ((payload.get("instagram") or {}).get("id")) or None,
            "instagram_username": ((payload.get("instagram") or {}).get("username")) or None,
            "permissions": [
                row.get("permission")
                for row in payload.get("permissions") or []
                if row.get("status") == "granted"
            ],
            "warning": None,
        }
        if days_until is not None and days_until <= args.warn_days:
            result["warning"] = (
                f"User token expires in {days_until} day(s). Generate a fresh short-lived user token and run bootstrap again."
            )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.print_env:
            print("\n# env")
            print(print_env(payload))
        return


if __name__ == "__main__":
    main()
