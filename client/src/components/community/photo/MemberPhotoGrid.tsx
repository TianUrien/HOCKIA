import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { useMemberAges } from '@/hooks/useMemberAges'
import { useMemberPhotosBatch } from '@/hooks/useMemberPhotos'
import { useOpenRolePositions } from '@/hooks/useOpenRoleCounts'
import { useClubCrestColors } from '@/hooks/useClubCrestColors'
import { prefetchFriendsInCommon } from '@/hooks/useFriendsInCommonBatch'
import { notifyBlockListChanged } from '@/hooks/useBlockedUsers'
import { invalidateFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import { getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { rememberBlockedPair } from '@/lib/publicProfileCache'
import { clubMetaLine, displayPlace, placeLabel } from '@/lib/communityCard'
import type { FitState } from '@/lib/clubRecruiting'
import type { Profile } from '../PeopleListView'
import { MemberPhotoCard } from './MemberPhotoCard'
import { ClubWideCard } from './ClubWideCard'

const MemberFullPreview = lazy(() => import('./MemberFullPreview'))

/**
 * The phone Community grid (Figma Community P1–P3, P15). One chronological
 * list (founder ruling 2026-10-11): people two per row (3:4 cards), clubs
 * always full width. Dense packing keeps a lone person next to the next
 * person instead of leaving a hole before a club. Margins 16, gap 12.
 *
 * Owns the full-screen preview and the "<Name> is blocked · Undo" toast that
 * follows a block from the preview (P26). Blocked members drop out of the
 * grid through useBlockedUsers in PeopleListView.
 */
interface MemberPhotoGridProps {
  members: Profile[]
  /** Recruiters only: fit per player id (Strong / Possible; grey → none). */
  fitById?: Map<string, FitState | null>
  /** Recruiters with Club v2 off-phone rules: open the full profile instead. */
  openProfile?: (member: Profile) => boolean
  /** The whole filtered list the deck swipes through (the grid shows a page of it). */
  deckMembers?: Profile[]
  /** "All members · Newest" — the deck's top label. */
  contextLabel?: string
  /** End of the deck → open the filters. */
  onAdjustFilters?: () => void
}

interface BlockedToast {
  member: Profile
  at: number
}

const UNDO_MS = 5000

export function MemberPhotoGrid({ members, fitById, openProfile, deckMembers, contextLabel = 'All members', onAdjustFilters }: MemberPhotoGridProps) {
  const { countries } = useCountries()
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const positions = useOpenRolePositions()
  const ids = useMemo(() => members.map((m) => m.id), [members])
  const personIds = useMemo(() => members.filter((m) => m.role !== 'club' && m.role !== 'brand').map((m) => m.id), [members])
  const photoIds = useMemo(() => members.filter((m) => m.role !== 'brand').map((m) => m.id), [members])
  const ages = useMemberAges(personIds)
  // Friends in common for the page in one call, so the deck opens on them.
  useEffect(() => { void prefetchFriendsInCommon(personIds) }, [personIds])
  const batch = useMemberPhotosBatch(photoIds)
  const clubs = useMemo(() => members.filter((m) => m.role === 'club'), [members])
  const crestColors = useClubCrestColors(clubs)
  const [preview, setPreview] = useState<Profile | null>(null)
  const [blocked, setBlocked] = useState<BlockedToast | null>(null)

  const placeOf = useCallback(
    (m: Profile, withCountry = false) => placeLabel(displayPlace(m.base_location, m.base_country_id, countries), withCountry),
    [countries],
  )

  useEffect(() => {
    if (!blocked) return
    const t = window.setTimeout(() => setBlocked(null), Math.max(0, UNDO_MS - (Date.now() - blocked.at)))
    return () => window.clearTimeout(t)
  }, [blocked])

  const undoBlock = async () => {
    const target = blocked?.member
    setBlocked(null)
    if (!target || !viewerId) return
    try {
      const { error } = await supabase.rpc('unblock_user', { p_blocked_id: target.id })
      if (error) throw error
      rememberBlockedPair(viewerId, target.id, false)
      notifyBlockListChanged()
      invalidateFriendshipEdges()
    } catch (err) {
      logger.error('[MemberPhotoGrid] undo block failed', err)
      addToast('Couldn’t undo the block. You can unblock in Settings.', 'error')
    }
  }

  const open = (m: Profile) => {
    if (openProfile?.(m)) return
    setPreview(m)
  }
  // Every card opens the deck (Figma P18): the full filtered list, starting here.
  const deckList = deckMembers && deckMembers.length > 0 ? deckMembers : members
  const deckStart = preview ? Math.max(0, deckList.findIndex((m) => m.id === preview.id)) : 0

  return (
    <>
      <div className="grid grid-flow-row-dense grid-cols-2 gap-3" data-testid="community-photo-grid" data-count={ids.length}>
        {members.map((m, i) => {
          if (m.role === 'club') {
            const cover = batch.photos.get(m.id)?.[0] ?? null
            const recruiting = (m.open_role_count ?? 0) > 0
            const meta = clubMetaLine({
              recruiting,
              positions: positions.get(m.id) ?? [],
              league: getPlayerLeagueName(m.current_world_club_id, null),
              place: placeOf(m, true),
            })
            return (
              <div key={m.id} className="col-span-2">
                <ClubWideCard
                  name={m.full_name?.trim() || 'Club'}
                  meta={meta}
                  coverUrl={batch.isPending(m.id) ? null : cover}
                  crestUrl={m.avatar_url}
                  crestColor={crestColors.get(m.id) ?? null}
                  recruiting={recruiting}
                  onOpen={() => open(m)}
                  priority={i < 3}
                />
              </div>
            )
          }
          const gallery = batch.photos.get(m.id)
          const pending = m.role !== 'brand' && batch.isPending(m.id)
          const photo = pending ? null : gallery?.[0] ?? m.avatar_url
          return (
            <MemberPhotoCard
              key={m.id}
              member={m}
              photoUrl={photo}
              pending={pending}
              age={ages.get(m.id) ?? null}
              place={placeOf(m)}
              fit={fitById?.get(m.id) ?? null}
              onOpen={() => open(m)}
              priority={i < 4}
            />
          )
        })}
      </div>

      {preview && (
        <Suspense fallback={null}>
          <MemberFullPreview
            member={preview}
            age={ages.get(preview.id) ?? null}
            fit={fitById?.get(preview.id) ?? null}
            crestColor={crestColors.get(preview.id) ?? null}
            deck={{
              members: deckList,
              startIndex: deckStart,
              contextLabel,
              ageOf: (id) => ages.get(id) ?? null,
              fitOf: (id) => fitById?.get(id) ?? null,
              crestOf: (id) => crestColors.get(id) ?? null,
              onAdjustFilters,
            }}
            onClose={() => setPreview(null)}
            onBlocked={(m) => setBlocked({ member: m, at: Date.now() })}
          />
        </Suspense>
      )}

      {blocked && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-50 flex justify-center px-4" role="status" aria-live="polite">
          <div className="pointer-events-auto flex w-full max-w-[361px] items-center justify-between gap-3 rounded-2xl bg-ink-1 py-3 pl-4 pr-2 text-white shadow-lg" data-testid="block-undo-toast">
            <span className="min-w-0 truncate text-row">{blocked.member.full_name?.trim() || 'Member'} is blocked</span>
            <button type="button" onClick={() => void undoBlock()} className="shrink-0 rounded-full px-3 py-1.5 text-row font-semibold text-white">
              Undo
            </button>
          </div>
        </div>
      )}
    </>
  )
}

