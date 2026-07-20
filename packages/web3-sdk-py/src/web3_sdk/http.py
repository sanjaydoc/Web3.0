"""Tiny JSON-over-HTTP helpers built on the standard library (no third-party HTTP dep)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class HttpError(Exception):
    def __init__(self, status: int, body: Any):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


def _request(method: str, url: str, payload: Any | None = None) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = raw
        raise HttpError(exc.code, body) from None


def get_json(url: str) -> Any:
    return _request("GET", url)


def post_json(url: str, payload: Any) -> Any:
    return _request("POST", url, payload)
