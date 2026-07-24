import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, ArrowRight, Lock } from 'lucide-react'
import { Avatar } from '@/components'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { profilePath } from '@/lib/profileNavigation'
import { logger } from '@/lib/logger'

/**
 * ConnectionsPreview — the public-portfolio Connections section
 * (reconciled design, 2026-07-22 panel review).
 *
 * The full connections list NEVER renders inline on the public profile:
 * - SIGNED-IN visitors get social proof: a fixed strip of up to
 *   MAX_FACES faces (clubs/coaches/verified ranked first — a visiting
 *   recruiter usually has no mutuals yet, so credential-rank beats
 *   recency) + "See all" into the dedicated connections page.
 * - ANONYMOUS visitors get the count + a sign-in CTA only. A public,
 *   crawlable page must not enumerate third parties' social graphs
 *   (the listed people never consented to that surface, and logged-out
 *   enumeration would bypass the block system).
 * - The count pill is suppressed below MIN_COUNT_TO_SHOW — a small
 *   number printed on a young profile is an anti-signal; faces alone
 *   carry the warmth.
 *
 * Fixed-height by construction: the strip never grows with network
 * size, so this section produces no layout shift and stays byte-cheap
 * at 7 or 700 connections.
 */

const MAX_FACES = 8
const MIN_COUNT_TO_SHOW = 10

type PreviewProfile =
  Database['public']['Functions']['get_profile_connections']['Returns'][number]

interface ConnectionsPreviewProps {
  profileId: string
  /** First name used in the anonymous sign-in copy. */
  profileFirstName: string | null
  /** Denormalized accepted_friend_count from the profile row. */
  totalConnections: number
  /** Signed-in viewers get faces; anonymous get count + sign-in CTA. */
  isAuthenticated: boolean
  /** Navigates to the dedicated connections page (existing /friends route). */
  onSeeAll: () => void
  /** Anonymous-CTA verb — "plays with" (people) vs "connects with" (clubs). */
  signInVerb?: string
}

const ROLE_RANK: Record<string, number> = { club: 0, coach: 1, umpire: 2, player: 3 }

export default function ConnectionsPreview({
  profileId,
  profileFirstName,
  totalConnections,
  isAuthenticated,
  onSeeAll,
  signInVerb = 'plays with',
}: ConnectionsPreviewProps) {
  const navigate = useNavigate()
  const [faces, setFaces] = useState<PreviewProfile[]>([])
  // Fenced total from get_profile_connections — what THIS viewer can
  // actually see. null until loaded (or on error): display then falls
  // back to the denormalized prop so the anon path and the skeleton
  // keep working unchanged.
  const [fencedTotal, setFencedTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(isAuthenticated)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    // Anonymous viewers get no graph data — by design, not just styling.
    if (!isAuthenticated) return
    let cancelled = false
    const load = async () => {
      try {
        // ONE shared RPC with the dedicated connections page — the faces,
        // the pill and "See all N" can never disagree with the list the
        // page will show. Over-fetch so credential-ranking has material.
        const { data, error } = await supabase.rpc('get_profile_connections', {
          p_profile_id: profileId,
          p_limit: MAX_FACES * 3,
          p_offset: 0,
        })
        if (error) throw error
        if (cancelled) return
        const rows = (data ?? []) as PreviewProfile[]
        setFencedTotal(rows.length > 0 ? Number(rows[0].total_count) : 0)
        // Rank for a stranger: clubs and coaches (the credibility-carrying
        // roles) first, verified before unverified, then recency (the
        // RPC's order — Array.sort is stable, so ties keep it).
        const ranked = [...rows].sort((a, b) => {
          const roleDiff =
            (ROLE_RANK[a.role ?? 'player'] ?? 9) - (ROLE_RANK[b.role ?? 'player'] ?? 9)
          if (roleDiff !== 0) return roleDiff
          return Number(Boolean(b.is_verified)) - Number(Boolean(a.is_verified))
        })
        setFaces(ranked.slice(0, MAX_FACES))
      } catch (err) {
        logger.error('[ConnectionsPreview] failed to load preview', err)
        if (!cancelled) {
          setFaces([])
          setLoadFailed(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profileId, isAuthenticated])

  // Signed-in surfaces show the FENCED number once known; anonymous (no
  // RPC access) and the pre-load skeleton use the denormalized prop.
  const displayTotal = isAuthenticated && fencedTotal !== null ? fencedTotal : totalConnections
  const showCount = displayTotal >= MIN_COUNT_TO_SHOW
  const firstName = profileFirstName?.trim().split(/\s+/)[0] ?? 'this member'

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Users className="h-5 w-5 text-hockia-primary" />
          Connections
        </h2>
        {showCount && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
            {displayTotal} connections
          </span>
        )}
      </div>
    ),
    [showCount, displayTotal]
  )

  // Nothing to show, nothing to sell — collapse entirely.
  if (totalConnections <= 0) return null

  if (!isAuthenticated) {
    return (
      <div data-testid="connections-preview" className="space-y-4">
        {header}
        <div className="flex flex-col items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="flex items-center gap-2 text-sm text-gray-600">
            <Lock className="h-4 w-4 flex-shrink-0 text-gray-400" />
            Sign in to see who {firstName} {signInVerb}.
          </p>
          <button
            type="button"
            onClick={() => navigate('/signin')}
            className="rounded-lg bg-hockia-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="connections-preview" className="space-y-4">
      {header}
      {loading ? (
        // Fixed-height skeleton: the strip's final height is known in
        // advance, so this section never shifts layout.
        <div className="flex gap-3" aria-hidden="true">
          {Array.from({ length: Math.min(totalConnections, MAX_FACES) }, (_, i) => (
            <div key={i} className="h-16 w-16 animate-pulse rounded-full bg-gray-100" />
          ))}
        </div>
      ) : loadFailed ? (
        <p className="text-sm text-gray-500">Couldn&apos;t load connections right now.</p>
      ) : faces.length === 0 ? (
        // The viewer's fences hid everything the denormalized gate let
        // through (blocked pairs / hidden / test accounts) — say so
        // instead of leaving a silent hollow card.
        <p className="text-sm text-gray-500">No connections to show.</p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          {faces.map((f) => {
            const path = profilePath(f.role, f.username, f.id)
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => path && navigate(path)}
                className="flex w-16 flex-col items-center gap-1 text-center"
                title={f.full_name ?? undefined}
              >
                <Avatar
                  src={f.avatar_url}
                  initials={(f.full_name ?? '?').slice(0, 2)}
                  size="lg"
                  role={f.role ?? undefined}
                />
                <span className="w-16 truncate text-[11px] text-gray-600">
                  {(f.full_name ?? '').split(/\s+/)[0]}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {displayTotal > MAX_FACES && (
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-hockia-primary hover:underline"
        >
          See all {displayTotal} connections
          <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
