#!/usr/bin/env node
// PreToolUse ガード（CLAUDE.md「禁止」「数値変更のルール」の強制。GDD 16.1 / Q-22）
// - main / master への push を拒否
// - 既存の data/balance.json の変更はプランナーの承認（ask）を要求
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const PROTECTED_BRANCHES = ['main', 'master'];
const BALANCE = 'data/balance.json';

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};
const cwd = input.cwd ?? process.cwd();

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function isBalancePath(p) {
  return typeof p === 'string' && resolve(cwd, p).endsWith(`/${BALANCE}`);
}

if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const p = args.file_path ?? args.notebook_path;
  if (isBalancePath(p) && existsSync(resolve(cwd, p))) {
    decide('ask', `${BALANCE} の変更にはプランナーの承認が必要です（案は docs/proposals/ に）。`);
  }
  process.exit(0);
}

if (tool === 'Bash') {
  const cmd = String(args.command ?? '');
  // git push: main/master を宛先にした push を拒否
  for (const seg of cmd.split(/&&|\|\||;|\n/)) {
    const tokens = seg.trim().split(/\s+/);
    const gi = tokens.indexOf('git');
    if (gi < 0 || !tokens.slice(gi + 1).includes('push')) continue;
    const rest = tokens.slice(tokens.indexOf('push', gi) + 1).filter((t) => !t.startsWith('-'));
    const refspecs = rest.slice(1); // 先頭は remote
    const targets = refspecs.map((r) => r.split(':').pop().replace(/^\+/, '').replace(/^refs\/heads\//, ''));
    const hitsProtected = targets.some((t) => PROTECTED_BRANCHES.includes(t))
      || (refspecs.length === 0 && PROTECTED_BRANCHES.includes(currentBranch()))
      || (targets.includes('HEAD') && PROTECTED_BRANCHES.includes(currentBranch()));
    if (hitsProtected) {
      decide('deny', 'main / master への直接 push は禁止です。作業ブランチに push してください。');
    }
  }
  // シェル経由の balance.json 書き換え
  if (cmd.includes(BALANCE) && /(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\bperl\s+-i|writeFile)/.test(cmd)) {
    decide('ask', `${BALANCE} を変更しうるコマンドです。プランナーの承認が必要です。`);
  }
}
process.exit(0);
