#!/usr/bin/env python3
"""PreToolUse hook: policy outside the model.

- Edits to protected paths (verifier, contract, gate config, hooks) -> deny.
  The builder must never be able to grade itself by weakening the check.
- Bash matching deny_commands -> deny.  Bash matching ask_commands -> ask a human.
No ACTIVE harness -> no-op.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hlib  # noqa: E402

WRITE_VERBS = re.compile(r"\b(tee|sed\s+-\w*i|perl\s+-\w*i|mv|cp|rm|chmod|chown|truncate|ln|install|git\s+(checkout|restore|rm|mv))\b")
FD_DUP = re.compile(r"\d*>&\d+|&>\s*/dev/null|\d*>\s*/dev/null")   # 2>&1, >/dev/null: not writes to a file we care about
SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\||\n")


def touches_protected(cmd, protected):
    """True if a simple command writes to a protected path (redirect target, or a mutating verb naming it).

    Reading or executing a protected file (bash verify.sh 2>&1 | tail) is allowed.
    """
    literals = [g.split("*")[0].rstrip("/") for g in protected]
    literals = [lit for lit in literals if lit]
    cleaned = FD_DUP.sub(" ", cmd)
    for lit in literals:
        esc = re.escape(lit)
        if re.search(r">>?\s*['\"]?(\./)?" + esc, cleaned):            # redirect into it
            return lit
    for seg in SEGMENT_SPLIT.split(cleaned):
        if WRITE_VERBS.search(seg):
            for lit in literals:
                if lit in seg:
                    return lit
    return None


def decide(decision, reason):
    hlib.emit({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                      "permissionDecision": decision,
                                      "permissionDecisionReason": reason}})


def main():
    hin = hlib.read_stdin_json()
    root = hlib.project_root(hin)
    slug = hlib.active_slug(root)
    if not slug:
        return
    cfg = hlib.load_config(root, slug)
    tool = hin.get("tool_name", "")
    tin = hin.get("tool_input") or {}
    protected = cfg["protected_paths"]

    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        path = hlib.rel(root, tin.get("file_path") or tin.get("notebook_path") or "")
        if hlib.matches_any(path, protected):
            hlib.trace(root, slug, "policy_deny", tool=tool, path=path)
            decide("deny", f"[harness:{slug}] {path} is protected (verifier/contract/gate). "
                           f"If the check itself is wrong, stop and tell the user instead of editing it.")
        return

    if tool in ("Bash", "PowerShell"):
        cmd = tin.get("command", "")
        for rx in cfg["deny_commands"]:
            if re.search(rx, cmd, re.I):
                hlib.trace(root, slug, "policy_deny", tool=tool, rule=rx)
                decide("deny", f"[harness:{slug}] command blocked by policy ({rx}).")
                return
        hit = touches_protected(cmd, protected)
        if hit:
            hlib.trace(root, slug, "policy_deny", tool=tool, path=hit)
            decide("deny", f"[harness:{slug}] command appears to modify protected path {hit}. "
                           f"Reading or running it is fine; changing it is not.")
            return
        for rx in cfg["ask_commands"]:
            if re.search(rx, cmd, re.I):
                hlib.trace(root, slug, "policy_ask", tool=tool, rule=rx)
                decide("ask", f"[harness:{slug}] external effect ({rx}) requires human approval.")
                return


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"harness guard error: {e}", file=sys.stderr)
        sys.exit(1)
