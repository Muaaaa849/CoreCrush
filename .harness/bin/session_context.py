#!/usr/bin/env python3
"""SessionStart hook (startup|resume|compact|clear): re-inject the durable state.

The next session inherits the state of the work, not a compressed story of the last conversation.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hlib  # noqa: E402


def main():
    hin = hlib.read_stdin_json()
    root = hlib.project_root(hin)
    slug = hlib.active_slug(root)
    if not slug:
        return
    hdir = root / ".harness" / slug
    state = hlib.load_state(root, slug)
    gate = hlib.load_gate(root, slug)
    lessons = ""
    lf = hdir / "lessons.md"
    if lf.is_file():
        lessons = "\n".join(lf.read_text().strip().splitlines()[-30:])
    ctx = (
        f"An active harness is enforcing this session: .harness/{slug}/\n"
        f"Before acting, read contract.yaml (objective, constraints, done_when) and map.md (where context lives).\n"
        f"Gate (read-only, owned by hooks): {json.dumps(gate, ensure_ascii=False)}\n"
        f"Current state.json (yours to update):\n{json.dumps(state, ensure_ascii=False, indent=2)}\n"
        f"Recent lessons (apply them):\n{lessons or '(none yet)'}\n"
        f"You cannot end the turn until the evidence gate passes; protected files cannot be edited."
    )
    hlib.trace(root, slug, "session_start", source=hin.get("source"))
    hlib.emit({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": ctx}})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"harness session_context error: {e}", file=sys.stderr)
