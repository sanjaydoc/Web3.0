"""Load a `.env` file into the environment — dependency-free, so Python agents read the same
config file as the node. Existing environment variables are never overwritten.
"""

from __future__ import annotations

import os
from pathlib import Path


def load_env(path: str | os.PathLike[str] | None = None) -> bool:
    """Load KEY=VALUE lines from a `.env` file into ``os.environ``.

    If ``path`` is omitted, searches the current directory and its parents for a `.env`
    (so it works whether you run from the repo root or a subfolder). Returns True if a file
    was loaded.
    """
    target = Path(path) if path else _find_dotenv()
    if not target or not target.is_file():
        return False
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
    return True


def _find_dotenv() -> Path | None:
    for directory in [Path.cwd(), *Path.cwd().parents]:
        candidate = directory / ".env"
        if candidate.is_file():
            return candidate
    return None
