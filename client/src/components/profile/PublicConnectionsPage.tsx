import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import { Avatar } from '@/components'
import RoleBadge from '@/components/RoleBadge'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { profilePath } from '@/lib/profileNavigation'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/**
 * PublicConnectionsPage — the dedicated visitor Connections screen behind
 * "See all" (the ONE real /:section sub-page in the reconciled design).
 *
 * Everything renders from get_profile_connections, the shared fenced RPC:
 * the header count and the list come from the SAME query, so they can
 * never disagree (the old FriendsTab-readOnly path paired an unfenced
 * denormalized count with an RLS-fenced list). Signed-in only — the
 * dashboards gate anonymous visitors before this mounts, and the RPC
 * re-checks auth server-side.
 *
 * FriendsTab stays the OWNER surface (requests, mutations, vouch CTAs);
 * this page is presentation-only.
 */

type ConnectionRow =
  Database['public']['Functions']['get_profile_connections']['Returns'][number]

const PAGE_SIZE = 24
const SEARCH_DEBOUNCE_MS = 300

const ROLE_FILTERS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'player', label: 'Players' },
  { value: 'coach', label: 'Coaches' },
  { value: 'club', label: 'Clubs' },
  { value: 'umpire', label: 'Umpires' },
  { value: 'brand', label: 'Brands' },
]

interface PublicConnectionsPageProps {
  profileId: string
  profileName: string | null
}

export default function PublicConnectionsPage({ profileId, profileName }: PublicConnectionsPageProps) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ConnectionRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  // Monotonic token: a stale response (older fetch resolving late) must
  // never clobber the newest filter's results.
  const fetchSeq = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = searchInput.trim()
      setSearch(trimmed.length > 0 ? trimmed : null)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++fetchSeq.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const { data, error } = await supabase.rpc('get_profile_connections', {
          p_profile_id: profileId,
          p_search: search ?? undefined,
          p_role: roleFilter ?? undefined,
          p_limit: PAGE_SIZE,
          p_offset: offset,
        })
        if (error) throw error
        if (seq !== fetchSeq.current) return
        const page = (data ?? []) as ConnectionRow[]
        setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
        setRows((prev) => (append ? [...prev, ...page] : page))
      } catch (err) {
        logger.error('[PublicConnectionsPage] fetch failed', err)
        if (seq === fetchSeq.current && !append) {
          setRows([])
          setTotal(0)
        }
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [profileId, search, roleFilter]
  )

  useEffect(() => {
    void fetchPage(0, false)
  }, [fetchPage])

  const hasMore = total !== null && rows.length < total
  const firstName = profileName?.trim().split(/\s+/)[0] ?? 'this member'
  const isFiltered = search !== null || roleFilter !== null

  return (
    <div className="space-y-5" data-testid="public-connections-page">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Users className="h-5 w-5 text-hockia-primary" />
          Connections
        </h2>
        {total !== null && !loading && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 tabular-nums">
            {total} {total === 1 ? 'connection' : 'connections'}
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name"
          aria-label="Search connections by name"
          className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none focus:ring-2 focus:ring-hockia-primary/20"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter connections by role">
        {ROLE_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setRoleFilter(f.value)}
            aria-pressed={roleFilter === f.value}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              roleFilter === f.value
                ? 'bg-hockia-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3">
              <div className="h-12 w-12 animate-pulse rounded-full bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-8 text-center text-sm text-gray-600">
          {isFiltered
            ? 'No connections match your search.'
            : `${firstName} has no connections to show yet.`}
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => {
              const path = profilePath(row.role, row.username, row.id)
              const subtitle = row.current_club || row.base_location || null
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => path && navigate(path)}
                    className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left transition-colors hover:border-gray-200 hover:bg-gray-50"
                  >
                    <Avatar
                      src={row.avatar_url}
                      initials={(row.full_name ?? '?').slice(0, 2)}
                      size="md"
                      role={row.role ?? undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {row.full_name ?? 'HOCKIA member'}
                      </p>
                      {subtitle && (
                        <p className="truncate text-xs text-gray-500">{subtitle}</p>
                      )}
                    </div>
                    <RoleBadge role={row.role} />
                  </button>
                </li>
              )
            })}
          </ul>

          {hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void fetchPage(rows.length, true)}
                className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : `Show more (${rows.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
