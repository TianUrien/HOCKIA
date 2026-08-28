/**
 * Attribution v2 — server-side contract tests.
 *
 * 1. Parity: the SQL registry (normalize_attribution) must agree with the
 *    client mirror on the ENTIRE corpus. If someone edits one and not the
 *    other, this fails — that is its whole job.
 * 2. Immutability: a second record_signup_attribution() call is a no-op.
 * 3. Fences: the admin report is admin-only; the rules table is read-only.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { authenticatePlayer, hasRequiredEnv, type AuthenticatedClient } from './setup'
import { ATTRIBUTION_CORPUS } from '../fixtures/attributionCorpus'

const skip = !hasRequiredEnv()

describe.skipIf(skip)('Attribution v2 (SQL)', () => {
  let user: AuthenticatedClient
  beforeAll(async () => { user = await authenticatePlayer() })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, params: Record<string, unknown>) => (user.client.rpc as any)(fn, params)

  describe('normalize_attribution parity with the client corpus', () => {
    for (const [utm, host, source, discarded] of ATTRIBUTION_CORPUS) {
      it(`utm=${utm ?? '∅'} host=${host ?? '∅'} → ${discarded ? 'DISCARD' : source}`, async () => {
        const { data, error } = await rpc('normalize_attribution', { p_utm_source: utm, p_referrer_host: host })
        expect(error).toBeNull()
        const row = data?.[0]
        expect(row.discarded).toBe(discarded)
        if (!discarded) expect(row.source).toBe(source)
      })
    }
  })

  describe('record_signup_attribution', () => {
    it('accepts a write from a member and never throws on repeat (first write wins server-side)', async () => {
      // Members cannot read signup_attribution (no RLS policy — admin surfaces
      // only), so immutability is proven by the staging verification script
      // and by the ON CONFLICT DO NOTHING contract; here we pin that repeated
      // calls are accepted silently rather than erroring a signup flow.
      const p = { anonymous_id: 'db-test', first_touch: { utm_source: 'qr', referring_domain: null, captured_at: new Date().toISOString() } }
      const a = await rpc('record_signup_attribution', { p })
      const b = await rpc('record_signup_attribution', { p: { ...p, first_touch: { ...p.first_touch, utm_source: 'linkedin' } } })
      expect(a.error).toBeNull()
      expect(b.error).toBeNull()
    })

    it('never records an auth-provider referrer as a source', async () => {
      const { data } = await rpc('normalize_attribution', { p_utm_source: null, p_referrer_host: 'accounts.google.com' })
      expect(data?.[0]?.discarded).toBe(true)
    })
  })

  describe('fences', () => {
    it('a normal member cannot read the acquisition report', async () => {
      const { error } = await rpc('admin_get_acquisition_report', { p_days: 30 })
      expect(error).not.toBeNull()
      expect(error?.message ?? '').toMatch(/admin/i)
    })

    it('the rules registry is readable but not writable by members', async () => {
      const { data, error } = await user.client.from('attribution_channel_rules').select('kind, pattern, source').limit(3)
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
      const { error: writeError } = await user.client.from('attribution_channel_rules').insert({ kind: 'utm', pattern: '^evil$', source: 'evil', channel_group: 'other', priority: 999 })
      expect(writeError).not.toBeNull()
    })
  })
})
