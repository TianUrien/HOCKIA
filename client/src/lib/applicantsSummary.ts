import { invokeNlSearch } from '@/hooks/useDiscover'
import type { Applicant } from '@/hooks/useRoleApplicants'
import { daysLeftToReply } from '@/lib/clubRecruiting'

/**
 * Hockia AI · applicants summary for the role's publisher (handoff C3, Figma
 * 180:397). Ruling 2026-10-18: facts only (role requirements vs profile
 * facts), recruiter-only, Beta, may compare applicants on those facts; never
 * age, gender, nationality or looks; no scores. Only these facts leave the
 * device — first name, days left, position / team category / open to play /
 * level closeness, invited. It costs one Hockia AI question, so it runs on
 * "Summarise" and is kept for the day for the same set of applicants.
 */
export interface SummaryFact {
  name: string
  daysLeft: number | null
  position: 'primary' | 'secondary' | 'no' | 'n/a'
  category: boolean | null
  open: boolean | null
  level: 'close' | 'further' | 'unknown'
  invited: boolean
}

export function summaryFacts(pending: Applicant[], expiryDays: number): SummaryFact[] {
  return pending.slice(0, 12).map((a) => {
    const c = a.fit?.components
    const pm = c?.position_match
    const prox = c?.competition_proximity
    return {
      name: a.person.fullName.trim().split(/\s+/)[0] || 'Applicant',
      daysLeft: daysLeftToReply(a.appliedAt, expiryDays),
      position: pm === undefined ? 'n/a' : pm >= 1 ? 'primary' : pm > 0 ? 'secondary' : 'no',
      category: c?.gender_match === undefined ? null : c.gender_match >= 1,
      open: c?.availability === undefined ? null : c.availability >= 0.6,
      level: prox === undefined || prox <= 0 ? 'unknown' : prox >= 0.75 ? 'close' : 'further',
      invited: a.invited,
    }
  })
}

const KEY = 'hockia-ai-applicants-summary'
const today = () => new Date().toISOString().slice(0, 10)
function cacheKey(roleId: string, pending: Applicant[]) {
  return `${roleId}:${pending.map((a) => a.applicationId).sort().join(',')}:${today()}`
}

export function cachedSummary(roleId: string, pending: Applicant[]): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>
    return all[cacheKey(roleId, pending)] ?? null
  } catch { return null }
}

function remember(roleId: string, pending: Applicant[], text: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>
    const t = today()
    const kept = Object.fromEntries(Object.entries(all).filter(([k]) => k.endsWith(t)))
    kept[cacheKey(roleId, pending)] = text
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch { /* storage blocked: the summary just isn't kept */ }
}

export type SummaryResult = { ok: true; text: string } | { ok: false; reason: 'cap' | 'error' }

export async function summariseApplicants(roleId: string, pending: Applicant[], expiryDays: number): Promise<SummaryResult> {
  try {
    const { data, error } = await invokeNlSearch({ mode: 'applicants_summary', opportunity_id: roleId, query: 'Summarise my applicants', applicants: summaryFacts(pending, expiryDays) })
    if (error) return { ok: false, reason: 'error' }
    const res = data as { kind?: string; ai_message?: string | null } | null
    if (res?.kind === 'cap_reached') return { ok: false, reason: 'cap' }
    if (!res?.ai_message || res.kind === 'soft_error') return { ok: false, reason: 'error' }
    remember(roleId, pending, res.ai_message)
    return { ok: true, text: res.ai_message }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
