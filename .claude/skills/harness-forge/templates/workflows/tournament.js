// Graph: N diverse attempts (isolated worktrees) -> gate each -> judge panel -> winner (+ grafts)
// For wide solution spaces (design, architecture, copy, hard bugs) where one iterated attempt gets stuck.
// args: { slug: string, task: string, angles?: string[] }
export const meta = {
  name: 'harness-tournament',
  description: 'Diverse parallel attempts, gated and judged; pick and graft the best',
  phases: [
    { title: 'Attempt', detail: 'one isolated attempt per angle' },
    { title: 'Gate', detail: 'deterministic checks per attempt' },
    { title: 'Judge', detail: 'panel scores surviving attempts' },
  ],
}

const angles = args.angles || ['simplest thing that satisfies done_when', 'risk-first / most robust', 'user-first / best experience']
const ATTEMPT = { type: 'object', required: ['summary', 'branch'], properties: { summary: { type: 'string' }, branch: { type: 'string' } } }
const GATE = { type: 'object', required: ['passed', 'tail'], properties: { passed: { type: 'boolean' }, tail: { type: 'string' } } }
const SCORE = { type: 'object', required: ['scores', 'winner', 'graft'],
  properties: { scores: { type: 'object' }, winner: { type: 'string' }, graft: { type: 'array', items: { type: 'string' } } } }

const attempts = await pipeline(angles,
  angle => agent(
    `Solve: ${args.task}\nAngle: ${angle}. Follow .harness/${args.slug}/contract.yaml. Commit your work to a new branch named harness/${args.slug}/<short-angle> and return its name.`,
    { phase: 'Attempt', schema: ATTEMPT, isolation: 'worktree', label: angle }),
  (att, angle) => att && agent(
    `git checkout ${att.branch} in an isolated worktree, run \`bash .harness/${args.slug}/verify.sh\`, report passed and the last 30 lines. Modify nothing.`,
    { phase: 'Gate', schema: GATE, isolation: 'worktree', effort: 'low', label: `gate ${angle}` })
    .then(g => ({ angle, ...att, gate: g })))

const survivors = attempts.filter(a => a && a.gate && a.gate.passed)
log(`${survivors.length}/${angles.length} attempts passed the gate`)
if (!survivors.length) return { status: 'escalated', attempts }

const panel = await parallel(['contract fit', 'maintainability', 'risk'].map(lens => () => agent(
  `Score each attempt 1-10 through the "${lens}" lens; name a winner and ideas worth grafting from runners-up.\n${JSON.stringify(survivors.map(s => ({ angle: s.angle, branch: s.branch, summary: s.summary })))}`,
  { phase: 'Judge', schema: SCORE, effort: 'high', label: lens })))
return { status: 'judged', survivors, panel: panel.filter(Boolean) }
