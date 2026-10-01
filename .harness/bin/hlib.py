"""Shared helpers for harness-forge runtime hooks.

Everything a harness needs at runtime lives under <project>/.harness/:
  .harness/ACTIVE            slug of the harness the gates enforce (absent = hooks no-op)
  .harness/bin/              these scripts (copied by harnessctl.py init)
  .harness/<slug>/harness.json   machine-readable gate config
  .harness/<slug>/gate.json      gate-owned counters/status (protected; only hooks write it)
  .harness/<slug>/state.json     builder-owned durable work state (system of record, not the transcript)
  .harness/<slug>/trace.jsonl    append-only event trace
"""
import fnmatch
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

DEFAULT_CONFIG = {
    "gate": "stop",               # stop | goal | none  (who decides "done")
    "verify_cmd": "bash .harness/{slug}/verify.sh",
    "verify_timeout_sec": 900,
    "max_iterations": 12,         # hard cap on gate evaluations
    "max_same_failure": 3,        # identical failure N times in a row -> stop and escalate
    "protected_paths": [          # builder may not edit these (anti reward-hacking)
        ".harness/{slug}/verify.sh",
        ".harness/{slug}/harness.json",
        ".harness/{slug}/contract.yaml",
        ".harness/{slug}/gate.json",
        ".harness/bin/*",
        ".harness/ACTIVE",
        ".claude/settings.json",
        ".claude/settings.local.json",
    ],
    "deny_commands": [            # regex; hard gate
        r"\bgit\s+push\s+.*(--force|-f)\b",
        r"\bgit\s+reset\s+--hard\s+origin",
        r"\brm\s+-rf\s+(/|~|\$HOME)(\s|$)",
        r"\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)\b",
        r"harnessctl\.py\s+(deactivate|activate|init|install-hooks)",  # the builder may not switch off its own gate
    ],
    "ask_commands": [             # regex; external effect -> human approval
        r"\bgit\s+push\b",
        r"\b(npm|pnpm|yarn)\s+publish\b",
        r"\bgh\s+(pr\s+merge|release\s+create)\b",
        r"\b(kubectl|terraform)\s+(apply|delete|destroy)\b",
        r"\bcurl\b.*\s-X\s*(POST|PUT|DELETE|PATCH)\b",
    ],
}


def project_root(hook_input=None):
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    if hook_input and hook_input.get("cwd"):
        p = Path(hook_input["cwd"])
        for cand in [p, *p.parents]:
            if (cand / ".harness").is_dir():
                return cand
    return Path.cwd()


def read_stdin_json():
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def active_slug(root):
    if os.environ.get("HARNESS_NESTED"):  # judge sessions spawned by verify.sh must not re-enter the gate
        return None
    f = root / ".harness" / "ACTIVE"
    if not f.is_file():
        return None
    slug = f.read_text().strip()
    return slug if slug and (root / ".harness" / slug).is_dir() else None


def load_config(root, slug):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    path = root / ".harness" / slug / "harness.json"
    if path.is_file():
        try:
            user = json.loads(path.read_text())
            for key in ("protected_paths", "deny_commands", "ask_commands"):
                cfg[key] = cfg[key] + list(user.pop("extra_" + key, []))  # extend, never silently drop defaults
            cfg.update(user)
        except Exception as e:  # a broken config must not silently disable gates
            cfg["_config_error"] = str(e)

    def fill(v):
        if isinstance(v, str):
            return v.replace("{slug}", slug)
        if isinstance(v, list):
            return [fill(x) for x in v]
        return v

    return {k: fill(v) for k, v in cfg.items()}


# One writer per file: gate.json belongs to the gate (protected), state.json to the builder.
def _load(root, slug, name, default):
    try:
        return json.loads((root / ".harness" / slug / name).read_text())
    except Exception:
        return dict(default)


def _save(root, slug, name, data):
    path = root / ".harness" / slug / name
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def load_gate(root, slug):
    return _load(root, slug, "gate.json", {"status": "planned", "iteration": 0})


def save_gate(root, slug, gate):
    _save(root, slug, "gate.json", gate)


def load_state(root, slug):
    return _load(root, slug, "state.json", {"slug": slug})


def trace(root, slug, event, **fields):
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "event": event, **fields}
    path = root / ".harness" / slug / "trace.jsonl"
    with path.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


_NOISE = [
    re.compile(r"\b\d+(\.\d+)?\s?(ms|s|sec|seconds|m|min)\b"),   # durations
    re.compile(r"\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?"),                # timestamps
    re.compile(r"0x[0-9a-f]+", re.I),                            # addresses
    re.compile(r"/tmp/\S+"),                                     # temp paths
]


def failure_signature(text):
    norm = text
    for rx in _NOISE:
        norm = rx.sub("#", norm)
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


def rel(root, file_path):
    try:
        return str(Path(file_path).resolve().relative_to(root.resolve()))
    except Exception:
        return str(file_path)


def matches_any(path, globs):
    return any(fnmatch.fnmatch(path, g) for g in globs)


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()
