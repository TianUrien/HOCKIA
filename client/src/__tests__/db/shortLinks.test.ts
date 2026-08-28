/**
 * Short links — server-side contract tests (staging).
 *
 * 1. A visitor with no session can resolve an active link and gets the utm set.
 * 2. Unknown codes resolve to null (the client goes home untagged).
 * 3. Members cannot read the tables or call the admin functions.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { authenticatePlayer, hasRequiredEnv, type AuthenticatedClient } from './setup'

const skip = !hasRequiredEnv()
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

describe.skipIf(skip)('Short links (SQL)', () => {
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let member: AuthenticatedClient
  beforeAll(async () => { member = await authenticatePlayer() })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (c: { rpc: any }, fn: string, params?: Record<string, unknown>) => c.rpc(fn, params)

  it('anonymous visitors resolve the starter pack and get the utm set', async () => {
    const { data, error } = await rpc(anon, 'resolve_short_link', { p_code: 'IG', p_platform: 'web', p_referrer_host: 'l.instagram.com', p_device: 'Mobile' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ code: 'ig', destination: '/', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'bio' })
  })

  it('the smart store link resolves with destination "store"', async () => {
    const { data, error } = await rpc(anon, 'resolve_short_link', { p_code: 'ig-app' })
    expect(error).toBeNull()
    expect(data?.destination).toBe('store')
  })

  it('an unknown code resolves to null, not an error', async () => {
    const { data, error } = await rpc(anon, 'resolve_short_link', { p_code: 'no-such-code-xyz' })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('members cannot read the link tables directly', async () => {
    const links = await member.client.from('short_links').select('code').limit(1)
    const clicks = await member.client.from('short_link_clicks').select('id').limit(1)
    expect(links.error ?? (links.data?.length === 0 ? null : 'readable')).not.toBe('readable')
    expect(clicks.error ?? (clicks.data?.length === 0 ? null : 'readable')).not.toBe('readable')
  })

  it('members cannot list or mint links', async () => {
    const list = await rpc(member.client, 'admin_list_short_links')
    expect(list.error?.message ?? '').toMatch(/admin/i)
    const mint = await rpc(member.client, 'admin_upsert_short_link', { p: { code: 'evil', label: 'x', destination: '/', utm_source: 'x' } })
    expect(mint.error?.message ?? '').toMatch(/admin/i)
  })
})
