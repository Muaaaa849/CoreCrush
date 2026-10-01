#!/usr/bin/env python3
"""Stop hook: the evidence gate.

Claude may only end its turn when the harness verifier (verify_cmd) exits 0.
- fail            -> block the stop and feed the failing evidence back (bounded loop)
- pass            -> one final turn to write receipt.md, then allow stop
- same failure xN -> stop retrying blindly; one final turn to write an escalation receipt
- iteration cap   -> same as above
- background work -> allow the stop; the background result wakes the session later
No ACTIVE harness, or gate != "stop" -> no-op.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hlib  # noqa: E402

TAIL_LINES = 60


def main():
    hin = hlib.read_stdin_json()
    root = hlib.project_root(hin)
    slug = hlib.active_slug(root)
    if not slug:
        return
    cfg = hlib.load_config(root, slug)
    if cfg.get("gate") != "stop":
        return
    gate = hlib.load_gate(root, slug)
    hdir = f".harness/{slug}"

    # Terminal states: the final "write the receipt" turn has happened -> release.
    if gate.get("status") in ("verified", "escalated"):
        receipt = root / hdir / "receipt.md"
        gate["status"] = "done" if gate["status"] == "verified" else "stopped"
        hlib.save_gate(root, slug, gate)
        hlib.trace(root, slug, "released", status=gate["status"], receipt=receipt.is_file())
        (root / ".harness" / "ACTIVE").unlink(missing_ok=True)
        hlib.emit({"systemMessage": f"[harness:{slug}] {gate['status']}. Receipt: {hdir}/receipt.md"})
        return

    running = [t for t in (hin.get("background_tasks") or []) if str(t.get("status", "")).lower() in ("running", "pending", "in_progress")]
    if running:
        hlib.trace(root, slug, "deferred", background=len(running))
        return

    if cfg.get("_config_error"):
        hlib.emit({"decision": "block", "reason": f"[harness:{slug}] harness.json is invalid ({cfg['_config_error']}). Tell the user; do not edit protected files."})
        return

    try:
        proc = subprocess.run(cfg["verify_cmd"], shell=True, cwd=root, capture_output=True, text=True,
                              timeout=int(cfg["verify_timeout_sec"]))
        code, out = proc.returncode, (proc.stdout + proc.stderr)
    except subprocess.TimeoutExpired:
        code, out = 124, f"verify_cmd timed out after {cfg['verify_timeout_sec']}s"

    tail = "\n".join(out.strip().splitlines()[-TAIL_LINES:])
    gate["iteration"] = int(gate.get("iteration", 0)) + 1
    it, cap = gate["iteration"], int(cfg["max_iterations"])

    if code == 0:
        gate["status"] = "verified"
        gate["last_failure_signature"], gate["same_failure_count"] = None, 0
        hlib.save_gate(root, slug, gate)
        hlib.trace(root, slug, "gate_pass", iteration=it)
        hlib.emit({"decision": "block", "reason": (
            f"[harness:{slug}] Evidence gate PASSED (iteration {it}/{cap}).\n{tail}\n\n"
            f"Final step: write {hdir}/receipt.md from templates (OBJECTIVE / CHANGED / VERIFIED with the evidence above / "
            f"NOT VERIFIED / RISKS / APPROVAL NEEDED / HARNESS LESSONS). Record final decisions/artifacts in {hdir}/state.json "
            f"(the gate keeps its own counters in gate.json) and append any lesson to {hdir}/lessons.md. Then stop.")})
        return

    sig = hlib.failure_signature(tail)
    same = int(gate.get("same_failure_count", 0)) + 1 if sig == gate.get("last_failure_signature") else 1
    gate["last_failure_signature"], gate["same_failure_count"] = sig, same
    hlib.trace(root, slug, "gate_fail", iteration=it, code=code, signature=sig, same=same)

    reason_stop = None
    if same >= int(cfg["max_same_failure"]):
        reason_stop = f"the identical failure repeated {same} times (signature {sig}) - another attempt is not worth it"
    elif it >= cap:
        reason_stop = f"iteration cap reached ({it}/{cap})"

    if reason_stop:
        gate["status"] = "escalated"
        gate["escalation"] = reason_stop
        hlib.save_gate(root, slug, gate)
        hlib.emit({"decision": "block", "reason": (
            f"[harness:{slug}] STOP: {reason_stop}.\nLast evidence:\n{tail}\n\n"
            f"Do not attempt another fix. Write {hdir}/receipt.md marking the objective NOT VERIFIED, classify the failure "
            f"(reference/recovery-and-learning.md), state what a human must decide, and add the harness improvement you "
            f"recommend to {hdir}/lessons.md. Then stop.")})
        return

    hlib.save_gate(root, slug, gate)
    hint = " This is the SAME failure as last time: change approach, do not repeat the previous fix." if same > 1 else ""
    hlib.emit({"decision": "block", "reason": (
        f"[harness:{slug}] Evidence gate FAILED (iteration {it}/{cap}, exit {code}).{hint}\n{tail}\n\n"
        f"Next: classify this failure (timeout->retry w/ backoff, bad args->repair call, missing context->retrieve via map.md, "
        f"failed check->inspect behavior, permission->request approval, conflicting requirements->escalate). "
        f"Update {hdir}/state.json (current_step, next_action, decisions), make the smallest change that moves toward "
        f"contract.yaml done_when, and never edit protected files (verify.sh, harness.json, contract.yaml, gate.json).")})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never wedge the session because the gate itself crashed
        print(f"harness stop_gate error: {e}", file=sys.stderr)
        sys.exit(1)
