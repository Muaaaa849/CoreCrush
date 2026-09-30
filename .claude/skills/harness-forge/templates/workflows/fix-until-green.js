// Graph: BUILD -> MEASURE -> (ACCEPT | REPAIR | STOP)  — a bounded fix loop with an external gate.
// Adapt: replace SLUG, keep the stop rules (max rounds, no-progress rounds). Load /workflow-authoring before editing.
// args: { slug: string, maxRounds?: number }
export const meta = {
  name: 'harness-fix-until-green',
  description: 'Repair until the harness verify.sh passes or progress stalls',
  phases: [
    { title: 'Measure', detail: 'run the evidence gate' },
    { title: 'Repair', detail: 'one focused fix per round' },
    { title: 'Verify', detail: 'independent disproof attempt' },
  ],
}

const slug = args.slug
const maxRounds = args.maxRounds || 6
const GATE = {
  type: 'object', required: ['passed', 'failing', 'output_tail'],
  properties: { passed: { type: 'boolean' }, failing: { type: 'array', items: { type: 'string' } }, output_tail: { type: 'string' } },
}
const VERDICT = {
  type: 'object', required: ['verdict', 'strongest_objection'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, strongest_objection: { type: 'string' } },
}

const measure = () => agent(
  `Run \`bash .harness/${slug}/verify.sh\` exactly once. Do not modify any file. Report passed (exit 0), the ids of FAIL lines, and the last 40 lines of output.`,
  { phase: 'Measure', schema: GATE, effort: 'low' })

let gate = await measure()
let bestFailing = gate ? gate.failing.length : Infinity
let stalled = 0
for (let round = 1; gate && !gate.passed && round <= maxRounds && stalled < 2; round++) {
  log(`round ${round}: failing ${gate.failing.join(', ')}`)
  await agent(
    `You are the builder for .harness/${slug}. Read contract.yaml, state.json and lessons.md. The evidence gate fails:\n${gate.output_tail}\n` +
    `Classify the failure, make the smallest change that fixes the first failing item, update state.json. Never edit protected files.`,
    { phase: 'Repair', label: `repair ${round}` })
  gate = await measure()
  const n = gate ? gate.failing.length : Infinity
  if (n < bestFailing) { bestFailing = n; stalled = 0 } else { stalled++ }   // no-progress detector
}

if (!gate || !gate.passed) {
  log('STOP: gate still failing (cap or two rounds without progress) - escalate to a human')
  return { status: 'escalated', gate }
}

const v = await agent(
  `Use the ${slug}-verifier procedure: try to prove the work in .harness/${slug} is UNACCEPTABLE against contract.yaml. Read-only.`,
  { phase: 'Verify', schema: VERDICT, agentType: `${slug}-verifier`, effort: 'high' })
return { status: v && v.verdict === 'PASS' ? 'done' : 'rejected-by-verifier', gate, verifier: v }
