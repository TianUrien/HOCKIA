import { useEffect, useState } from 'react'
import { Image as ImageIcon, Film, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import DashboardCard from './DashboardCard'
import type { Profile } from '@/lib/supabase'

/**
 * MediaCard — up to 3 tiles depending on role:
 *   Player:
 *     - Highlights      → profiles.highlight_video_url (0 or 1)
 *     - Full Matches    → profiles.full_game_video_count (denormalized)
 *     - Gallery         → gallery_photos count (one extra query)
 *   Coach / Club (any non-player role):
 *     - Gallery only — coaches and clubs don't have highlight reels or
 *       full-match footage as concepts, so a 3-tile layout with two
 *       hard-coded zeros wastes space. The card collapses to a single
 *       full-width gallery tile.
 *
 * Gallery data source differs by role: players/coaches use the
 * `gallery_photos` table keyed by `user_id`; clubs use the separate
 * `club_media` table keyed by `club_id`.
 *
 * Highlight + full-game counts come from the profile row already in
 * memory, so only gallery requires a network round-trip.
 */
interface MediaCardProps {
  /** Subset of Profile that the card actually reads. */
  profile: Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>
  readOnly: boolean
  onManageMedia: () => void
  /** Owner role — drives which tiles are rendered and which gallery
   *  table is queried. Defaults to 'player' for backwards compat. */
  role?: 'player' | 'coach' | 'club'
  /** When true, the card spans both columns of the Bento grid on md+. */
  fullWidth?: boolean
}

export default function MediaCard({ profile, readOnly, onManageMedia, role = 'player', fullWidth = false }: MediaCardProps) {
  const [galleryCount, setGalleryCount] = useState<number | null>(null)
  const isClub = role === 'club'
  // Coach and Club both render the single-tile gallery-only layout.
  const isGalleryOnly = role === 'coach' || role === 'club'

  useEffect(() => {
    let cancelled = false
    async function fetchCount() {
      // Clubs store gallery photos in club_media (keyed by club_id);
      // players/coaches use gallery_photos (keyed by user_id).
      const { count, error } = isClub
        ? await supabase
            .from('club_media')
            .select('id', { count: 'exact', head: true })
            .eq('club_id', profile.id)
        : await supabase
            .from('gallery_photos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)

      if (cancelled) return
      if (error) {
        logger.error('[MEDIA_CARD] Failed to fetch gallery count', error)
        setGalleryCount(0)
      } else {
        setGalleryCount(count ?? 0)
      }
    }
    void fetchCount()
    return () => {
      cancelled = true
    }
  }, [profile.id, isClub])

  const highlightCount = profile.highlight_video_url?.trim() ? 1 : 0
  const fullMatchCount = profile.full_game_video_count ?? 0
  const totalItems = isGalleryOnly
    ? galleryCount ?? 0
    : highlightCount + fullMatchCount + (galleryCount ?? 0)
  const isEmpty = totalItems === 0 && galleryCount !== null

  return (
    <DashboardCard
      icon={Play}
      title="Media"
      subtitle={
        isClub
          ? 'Photos from matches, training and club life'
          : isGalleryOnly
            ? 'Photos from matches, training and your career'
            : 'Highlights, match footage and gallery'
      }
      ctaLabel={readOnly && isEmpty ? undefined : readOnly ? 'View media' : 'Manage media'}
      onCtaClick={onManageMedia}
      testId="media-card"
      fullWidth={fullWidth}
    >
      {isEmpty && readOnly ? (
        <p className="text-sm text-gray-500">No media shared yet.</p>
      ) : isGalleryOnly ? (
        // Coach / Club: single Gallery tile, full width. Cleaner than a
        // 3-tile grid with two hard-coded zeros.
        <Tile
          icon={ImageIcon}
          label="Gallery"
          count={galleryCount ?? 0}
          loading={galleryCount === null}
          isEmpty={galleryCount === 0}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          <Tile
            icon={Play}
            label="Highlights"
            count={highlightCount}
            loading={false}
            isEmpty={highlightCount === 0}
          />
          <Tile
            icon={Film}
            label="Full matches"
            count={fullMatchCount}
            loading={false}
            isEmpty={fullMatchCount === 0}
          />
          <Tile
            icon={ImageIcon}
            label="Gallery"
            count={galleryCount ?? 0}
            loading={galleryCount === null}
            isEmpty={galleryCount === 0}
          />
        </div>
      )}
    </DashboardCard>
  )
}

interface TileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  loading: boolean
  isEmpty: boolean
}

function Tile({ icon: Icon, label, count, loading, isEmpty }: TileProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center',
        isEmpty
          ? 'border-dashed border-gray-200 bg-gray-50/50'
          : 'border-gray-100 bg-gradient-to-br from-[#8026FA]/[0.04] to-[#ec4899]/[0.04]',
      )}
    >
      <Icon className={cn('h-5 w-5', isEmpty ? 'text-gray-400' : 'text-[#8026FA]')} />
      <span
        className={cn(
          'text-base font-bold tabular-nums leading-none',
          isEmpty ? 'text-gray-400' : 'text-gray-900',
        )}
      >
        {loading ? '—' : count}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium leading-none">
        {label}
      </span>
    </div>
  )
}
