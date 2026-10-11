/**
 * Community never lists anyone in a block relationship with the viewer
 * (either side), in the grid AND its count — server first (the RPC), and the
 * client hides a just-blocked member at once and re-keys its queries so the
 * server count refreshes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = (p: string) => readFileSync(resolve(__dirname, '..', '..', '..', p), 'utf8')
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

const MIGRATION = 'supabase/migrations/20261011100000_community_hide_blocked_members.sql'

describe('community_search_members block filter (server)', () => {
  const sql = repo(MIGRATION)

  it('keeps the exact signature (old app builds keep calling it)', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.community_search_members(p_role text DEFAULT NULL')
    expect(sql).toContain('p_open_opportunity_type text DEFAULT NULL')
    expect(sql).not.toMatch(/DROP FUNCTION/)
  })

  it('applies the block predicate to the COUNT and to the rows, both directions', () => {
    const blocks = sql.match(/FROM public\.user_blocks ub/g) ?? []
    expect(blocks).toHaveLength(2)
    expect(sql.match(/ub\.blocker_id = auth\.uid\(\) AND ub\.blocked_id = p\.id/g)).toHaveLength(2)
    expect(sql.match(/ub\.blocker_id = p\.id AND ub\.blocked_id = auth\.uid\(\)/g)).toHaveLength(2)
    // The count block sits before the rows SELECT.
    expect(sql.indexOf('FROM public.user_blocks ub')).toBeLessThan(sql.indexOf('INTO v_results'))
  })

  it('anonymous callers are unaffected and the existing fences stay', () => {
    expect(sql).toContain('auth.uid() IS NULL OR NOT EXISTS')
    expect(sql.match(/profile_is_uncontactable/g)).toHaveLength(2)
    expect(sql.match(/profile_is_adult/g)).toHaveLength(2)
  })

  it('has a rollback file', () => {
    expect(repo('supabase/rollbacks/20261011100000_community_hide_blocked_members.down.sql')).toContain(
      'CREATE OR REPLACE FUNCTION public.community_search_members(',
    )
  })
})

describe('Community grid (client)', () => {
  const plv = src('components/community/PeopleListView.tsx')

  it('drops blocked members from the list at once', () => {
    expect(plv).toContain("import { useBlockedUsers } from '@/hooks/useBlockedUsers'")
    expect(plv).toContain('result = result.filter(m => !blockedIds.has(m.id))')
  })

  it('re-keys the member and count queries on a block change so the server count refreshes', () => {
    expect(plv).toMatch(/qk\.communityMembers\(viewerScope, `\$\{JSON\.stringify\(rpcParams\)\}\|blocks:\$\{blockKey\}`\)/)
    expect(plv).toContain('|blocks:${blockKey}`)')
  })
})
