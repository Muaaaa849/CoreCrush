// Graph: DISCOVER -> fan-out WORK (per item) -> fan-out REFUTE (diverse lenses) -> CONVERGE
// For audits, migrations and research: many independent items, each checked by skeptics before it counts.
// args: { slug: string, discover: string, work: string, lenses?: string[] }
export const meta = {
  name: 'harness-fanout-refute-converge',
  description: 'Discover items, process each, adversarially verify, merge survivors',
  phases: [
    { title: 'Discover', detail: 'enumerate the work items' },
    { title: 'Work', detail: 'one agent per item' },
    { title: 'Refute', detail: 'independent skeptics per result' },
    { title: 'Converge', detail: 'dedupe, rank, report' },
  ],
}

const lenses = args.lenses || ['correctness', 'contract constraints', 'does it reproduce / is it sourced']
const ITEMS = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } }
const RESULT = { type: 'object', required: ['item', 'claim', 'evidence'],
  properties: { item: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' } } }
const VOTE = { type: 'object', required: ['refuted', 'why'], properties: { refuted: { type: 'boolean' }, why: { type: 'string' } } }

const found = await agent(`${args.discover}\nContract: .harness/${args.slug}/contract.yaml. Return every item; no sampling.`,
  { phase: 'Discover', schema: ITEMS })
if (!found || !found.items.length) { log('nothing to do'); return [] }
log(`${found.items.length} items`)

const results = await pipeline(found.items,
  item => agent(`${args.work}\nItem: ${item}\nReturn the claim you make about it and the concrete evidence (command output, file:line, source URL).`,
    { phase: 'Work', schema: RESULT, label: item }),
  async (res, item) => {
    if (!res) return null
    const votes = await parallel(lenses.map(lens => () => agent(
      `Try to REFUTE this result through the "${lens}" lens. Default to refuted=true if the evidence does not prove it.\n${JSON.stringify(res)}`,
      { phase: 'Refute', schema: VOTE, effort: 'high', label: `${lens}: ${item}` })))
    const standing = votes.filter(Boolean).filter(v => !v.refuted).length
    return { ...res, survives: standing >= Math.ceil(lenses.length / 2), votes: votes.filter(Boolean) }
  })

const kept = results.filter(r => r && r.survives)
const dropped = results.filter(r => r && !r.survives)
log(`kept ${kept.length}, refuted ${dropped.length}, failed ${results.filter(r => !r).length}`)   // no silent caps

return agent(
  `Merge these verified results into one ranked report for .harness/${args.slug} (write it to the deliverable path in contract.yaml). ` +
  `List refuted items separately with the reason.\nKEPT: ${JSON.stringify(kept)}\nREFUTED: ${JSON.stringify(dropped.map(d => ({ item: d.item, why: d.votes.map(v => v.why) })))}`,
  { phase: 'Converge' })
