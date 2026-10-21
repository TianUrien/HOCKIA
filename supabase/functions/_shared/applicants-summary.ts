// Hockia AI · applicants summary for the role's publisher (handoff C3, Figma
// 180:397). Ruling 2026-10-18: facts only — role requirements vs profile
// facts — recruiter-only, labelled Beta; may compare applicants on those
// facts; never age, gender, nationality or looks; no scores or promises.
// The client sends only whitelisted facts per applicant; this module keeps
// exactly those, so nothing else can reach the model.

export const SUMMARY_MODE = 'applicants_summary'
export const SUMMARY_MAX_APPLICANTS = 12

export interface ApplicantFact {
  name: string // first name only
  daysLeft: number | null
  position: 'primary' | 'secondary' | 'no' | 'n/a'
  category: boolean | null
  open: boolean | null
  level: 'close' | 'further' | 'unknown'
  invited: boolean
}

export const SUMMARY_SYSTEM = [
  'You summarise the applicants waiting for a club\'s reply on Hockia, for the club.',
  'Write 2–3 short sentences, plain and neutral. Start with how many are waiting.',
  'Use ONLY the facts given: position match, team category match, open to play, level closeness to the club, days left to reply, invited.',
  'You may compare applicants on those facts and say who closes first.',
  'Never mention or guess age, gender, nationality, appearance or anything not given. No scores, percentages, rankings or recommendations to sign someone.',
  'No emoji, no lists, no placeholders. Reply with the summary only.',
  'Never use em dashes (—) in your answers; use a period, a colon, a comma or parentheses.',
].join('\n')

const POS = ['primary', 'secondary', 'no', 'n/a'] as const
const LEVEL = ['close', 'further', 'unknown'] as const

export function sanitizeApplicants(raw: unknown): ApplicantFact[] {
  return (Array.isArray(raw) ? raw : []).slice(0, SUMMARY_MAX_APPLICANTS).flatMap((x) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.replace(/[^\p{L}\p{M}' -]/gu, '').trim().split(/\s+/)[0]?.slice(0, 30) : ''
    if (!name) return []
    return [{
      name,
      daysLeft: typeof o.daysLeft === 'number' && Number.isFinite(o.daysLeft) ? Math.max(0, Math.min(60, Math.round(o.daysLeft))) : null,
      position: (POS as readonly string[]).includes(o.position as string) ? o.position as ApplicantFact['position'] : 'n/a',
      category: typeof o.category === 'boolean' ? o.category : null,
      open: typeof o.open === 'boolean' ? o.open : null,
      level: (LEVEL as readonly string[]).includes(o.level as string) ? o.level as ApplicantFact['level'] : 'unknown',
      invited: o.invited === true,
    }]
  })
}

export function summaryFacts(roleTitle: string, list: ApplicantFact[]): string {
  const yesNo = (v: boolean | null, yes: string, no: string) => (v === null ? null : v ? yes : no)
  return [`Role: ${roleTitle}`, `${list.length} waiting for a reply:`, ...list.map((a) => [
    `- ${a.name}`,
    a.position === 'primary' ? 'plays the role\'s position' : a.position === 'secondary' ? 'plays the role\'s position as a second position' : a.position === 'no' ? 'plays another position' : null,
    yesNo(a.category, 'team category matches', 'team category doesn\'t match'),
    yesNo(a.open, 'open to play', 'not marked open to play'),
    a.level === 'close' ? 'plays at a level close to the club\'s' : a.level === 'further' ? 'plays a little further from the club\'s level' : 'level can\'t be compared yet',
    a.daysLeft !== null ? `${a.daysLeft} days left to reply` : null,
    a.invited ? 'applied from the club\'s invite' : null,
  ].filter(Boolean).join(', '))].join('\n')
}
