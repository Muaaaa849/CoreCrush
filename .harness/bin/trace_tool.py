#!/usr/bin/env python3
"""PostToolUse / PostToolUseFailure hook (async): append one line per tool call to trace.jsonl.

Enough to reconstruct the run ("make failure local"), small enough to stay cheap.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hlib  # noqa: E402


def summarize(tool, tin):
    for key in ("command", "file_path", "pattern", "url", "query", "description", "prompt"):
        if key in tin:
            return str(tin[key])[:200]
    return ""


def main():
    hin = hlib.read_stdin_json()
    root = hlib.project_root(hin)
    slug = hlib.active_slug(root)
    if not slug:
        return
    tool = hin.get("tool_name", "")
    ok = hin.get("hook_event_name") != "PostToolUseFailure"
    hlib.trace(root, slug, "tool", tool=tool, ok=ok, input=summarize(tool, hin.get("tool_input") or {}),
               error=str(hin.get("error", ""))[:300] if not ok else None)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
