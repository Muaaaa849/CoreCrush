#!/usr/bin/env python3
"""harnessctl: scaffold, install, activate and inspect harnesses.

  init <slug> --objective TEXT [--gate stop|goal|none] [--max-iterations N] [--force]
  install-hooks [--target .claude/settings.local.json] [--block-cap N]
  activate <slug> [--gate stop|goal|none]
  deactivate <slug> [--status done|stopped|paused]
  status [slug]
  check <slug>          validate files, config, hooks; run the verifier once
"""
import argparse
import datetime
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

BIN = Path(__file__).resolve().parent
sys.path.insert(0, str(BIN))
import hlib  # noqa: E402

TEMPLATES = BIN.parent.parent / "templates"   # only present when run from the skill directory
HOOK_MARK = ".harness/bin/"
RUNTIME = ["hlib.py", "stop_gate.py", "guard.py", "trace_tool.py", "session_context.py", "run_loop.sh", "harnessctl.py"]
PER_HARNESS = ["contract.yaml", "map.md", "state.json", "lessons.md", "receipt.md", "verify.sh", "prompt.md", "harness.json", "launch.md"]


def root():
    return hlib.project_root()


def cmd_init(a):
    r = root()
    if not TEMPLATES.is_dir():
        sys.exit("init must run from the skill copy of harnessctl.py (templates/ not found)")
    bindir = r / ".harness" / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    for f in RUNTIME:
        shutil.copy2(BIN / f, bindir / f)
    for f in bindir.glob("*"):
        f.chmod(f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    hdir = r / ".harness" / a.slug
    hdir.mkdir(parents=True, exist_ok=True)
    subs = {
        "{{SLUG}}": a.slug,
        "{{OBJECTIVE}}": a.objective,
        "{{DATE}}": datetime.date.today().isoformat(),
        "{{GATE}}": a.gate,
        "{{MAX_ITERATIONS}}": str(a.max_iterations),
    }
    written = []
    for name in PER_HARNESS:
        dst = hdir / name
        if dst.exists() and not a.force:
            continue
        text = (TEMPLATES / name).read_text()
        for k, v in subs.items():
            text = text.replace(k, v)
        dst.write_text(text)
        written.append(name)
    (hdir / "verify.sh").chmod(0o755)
    agents = r / ".claude" / "agents"
    agents.mkdir(parents=True, exist_ok=True)
    va = agents / f"{a.slug}-verifier.md"
    if not va.exists() or a.force:
        va.write_text((TEMPLATES / "verifier-agent.md").read_text().replace("{{SLUG}}", a.slug))
        written.append(str(va.relative_to(r)))
    gi = r / ".harness" / ".gitignore"
    if not gi.exists():
        gi.write_text("ACTIVE\n__pycache__/\n*/trace.jsonl\n*/session-*.jsonl\n*/last_verify.txt\n")
    print(json.dumps({"harness": str(hdir.relative_to(r)), "written": written}, ensure_ascii=False, indent=2))


def hook_block(event, script, matcher=None, async_=False, timeout=None):
    h = {"type": "command", "command": f'python3 "${{CLAUDE_PROJECT_DIR}}/{HOOK_MARK}{script}"'}
    if async_:
        h["async"] = True
    if timeout:
        h["timeout"] = timeout
    block = {"hooks": [h]}
    if matcher:
        block["matcher"] = matcher
    return event, block


def cmd_install_hooks(a):
    r = root()
    target = r / a.target
    target.parent.mkdir(parents=True, exist_ok=True)
    settings = json.loads(target.read_text()) if target.is_file() else {}
    hooks = settings.setdefault("hooks", {})
    wanted = [
        hook_block("Stop", "stop_gate.py", timeout=1200),
        hook_block("PreToolUse", "guard.py", matcher="Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell"),
        hook_block("PostToolUse", "trace_tool.py", matcher="*", async_=True),
        hook_block("PostToolUseFailure", "trace_tool.py", matcher="*", async_=True),
        hook_block("SessionStart", "session_context.py", matcher="startup|resume|compact|clear"),
    ]
    added = []
    for event, block in wanted:
        entries = hooks.setdefault(event, [])
        entries[:] = [e for e in entries if not any(HOOK_MARK in h.get("command", "") for h in e.get("hooks", []))]
        entries.append(block)
        added.append(event)
    env = settings.setdefault("env", {})
    env["CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"] = str(a.block_cap)
    target.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"settings": str(target.relative_to(r)), "hooks": added,
                      "env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP": a.block_cap,
                      "note": "Hooks no-op unless .harness/ACTIVE names a harness. New hooks load on the next session "
                              "(or open /hooks to confirm)."}, indent=2))


def _set_gate(r, slug, gate):
    p = r / ".harness" / slug / "harness.json"
    cfg = json.loads(p.read_text()) if p.is_file() else {}
    cfg["gate"] = gate
    p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")


def cmd_activate(a):
    r = root()
    if not (r / ".harness" / a.slug).is_dir():
        sys.exit(f"no harness .harness/{a.slug}")
    if a.gate:
        _set_gate(r, a.slug, a.gate)
    hlib.save_gate(r, a.slug, {"status": "running", "iteration": 0, "same_failure_count": 0,
                               "last_failure_signature": None,
                               "started_at": datetime.datetime.now().isoformat(timespec="seconds")})
    (r / ".harness" / "ACTIVE").write_text(a.slug + "\n")
    hlib.trace(r, a.slug, "activated", gate=hlib.load_config(r, a.slug)["gate"])
    print(f"active: {a.slug}")


def cmd_deactivate(a):
    r = root()
    act = r / ".harness" / "ACTIVE"
    if act.is_file() and act.read_text().strip() == a.slug:
        act.unlink()
    g = hlib.load_gate(r, a.slug)
    g["status"] = a.status
    hlib.save_gate(r, a.slug, g)
    hlib.trace(r, a.slug, "deactivated", status=a.status)
    print(f"inactive: {a.slug} ({a.status})")


def cmd_status(a):
    r = root()
    slug = a.slug or hlib.active_slug(r)
    if not slug:
        base = r / ".harness"
        names = sorted(p.name for p in base.iterdir() if p.is_dir() and p.name != "bin") if base.is_dir() else []
        print(json.dumps({"active": None, "harnesses": names}, indent=2))
        return
    st = hlib.load_state(r, slug)
    g = hlib.load_gate(r, slug)
    tr = r / ".harness" / slug / "trace.jsonl"
    last = tr.read_text().strip().splitlines()[-8:] if tr.is_file() else []
    print(json.dumps({"active": hlib.active_slug(r), "slug": slug, "gate": g, "state": st,
                      "recent_trace": [json.loads(x) for x in last if x.strip()]}, ensure_ascii=False, indent=2))


def cmd_check(a):
    r = root()
    hdir = r / ".harness" / a.slug
    problems, notes = [], []
    for name in PER_HARNESS:
        if not (hdir / name).is_file():
            problems.append(f"missing {name}")
    for name in ("state.json", "harness.json"):
        try:
            json.loads((hdir / name).read_text())
        except Exception as e:
            problems.append(f"{name} invalid JSON: {e}")
    cfg = hlib.load_config(r, a.slug)
    if cfg.get("gate") == "stop":
        cap = int(os.environ.get("CLAUDE_CODE_STOP_HOOK_BLOCK_CAP", "0") or 0)
        settings_caps = []
        for s in (".claude/settings.json", ".claude/settings.local.json"):
            p = r / s
            if p.is_file():
                try:
                    settings_caps.append(int(json.loads(p.read_text()).get("env", {}).get("CLAUDE_CODE_STOP_HOOK_BLOCK_CAP", 0)))
                except Exception:
                    pass
        cap = max([cap, *settings_caps, 8])
        if cap < int(cfg["max_iterations"]) + 2:
            problems.append(f"stop-hook block cap {cap} < max_iterations+2; run install-hooks --block-cap {int(cfg['max_iterations']) + 2}")
        installed = any(HOOK_MARK in json.dumps(json.loads((r / s).read_text()).get("hooks", {}))
                        for s in (".claude/settings.json", ".claude/settings.local.json") if (r / s).is_file())
        if not installed:
            problems.append("gate=stop but hooks are not installed (run install-hooks)")
    if not (r / ".claude" / "agents" / f"{a.slug}-verifier.md").is_file():
        notes.append("no verifier subagent (fine for purely deterministic gates)")
    for name in ("verify.sh", "contract.yaml"):
        f = hdir / name
        if f.is_file() and "TODO" in f.read_text():
            problems.append(f"{name} still contains TODO placeholders")
    try:
        p = subprocess.run(cfg["verify_cmd"], shell=True, cwd=r, capture_output=True, text=True,
                           timeout=int(cfg["verify_timeout_sec"]))
        tail = "\n".join((p.stdout + p.stderr).strip().splitlines()[-25:])
        notes.append(f"baseline verify exit={p.returncode} (a red baseline is expected before work starts)\n{tail}")
    except subprocess.TimeoutExpired:
        problems.append("verify_cmd timed out")
    print(json.dumps({"slug": a.slug, "ok": not problems, "problems": problems, "notes": notes}, ensure_ascii=False, indent=2))
    sys.exit(0 if not problems else 1)


def main():
    ap = argparse.ArgumentParser(prog="harnessctl")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("init")
    p.add_argument("slug")
    p.add_argument("--objective", required=True)
    p.add_argument("--gate", default="stop", choices=["stop", "goal", "none"])
    p.add_argument("--max-iterations", type=int, default=12)
    p.add_argument("--force", action="store_true")
    p = sp.add_parser("install-hooks")
    p.add_argument("--target", default=".claude/settings.local.json")
    p.add_argument("--block-cap", type=int, default=20)
    p = sp.add_parser("activate")
    p.add_argument("slug")
    p.add_argument("--gate", choices=["stop", "goal", "none"])
    p = sp.add_parser("deactivate")
    p.add_argument("slug")
    p.add_argument("--status", default="paused", choices=["done", "stopped", "paused"])
    p = sp.add_parser("status")
    p.add_argument("slug", nargs="?")
    p = sp.add_parser("check")
    p.add_argument("slug")
    a = ap.parse_args()
    {"init": cmd_init, "install-hooks": cmd_install_hooks, "activate": cmd_activate,
     "deactivate": cmd_deactivate, "status": cmd_status, "check": cmd_check}[a.cmd](a)


if __name__ == "__main__":
    main()
