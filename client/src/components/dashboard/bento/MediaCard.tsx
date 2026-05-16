import { useEffect, useState } from 'react'
import { Image as ImageIcon, Film, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import DashboardCard from './DashboardCard'
import type { Profile } from '@/lib/supabase'

/**
 * MediaCard — 3 tiles:
 *   - Highlights      → profiles.highlight_video_url (0 or 1)
 *   - Full Matches    → profiles.full_game_video_count (denormalized)
 *   - Gallery         → gallery_photos count (one extra query)
 *
 * Highlight + full-game counts come from the profile row already in
 * memory, so only gallery requires a network round-trip.
 */
interface MediaCardProps {
  /** Subset of Profile that the card actually reads. */
  profile: Pick<Profile, 'id' | 'highlight_video_url' | 'full_game_video_count'>
  readOnly: boolean
  onManageMedia: () => void
}

export default function MediaCard({ profile, readOnly, onManageMedia }: MediaCardProps) {
  const [galleryCount, setGalleryCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchCount() {
      const { count, error } = await supabase
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
  }, [profile.id])

  const highlightCount = profile.highlight_video_url?.trim() ? 1 : 0
  const fullMatchCount = profile.full_game_video_count ?? 0
  const totalItems = highlightCount + fullMatchCount + (galleryCount ?? 0)
  const isEmpty = totalItems === 0 && galleryCount !== null

  return (
    <DashboardCard
      icon={Play}
      title="Media"
      subtitle="Highlights, match footage and gallery"
      ctaLabel={readOnly && isEmpty ? undefined : readOnly ? 'View media' : 'Manage media'}
      onCtaClick={onManageMedia}
      testId="media-card"
    >
      {isEmpty && readOnly ? (
        <p className="text-sm text-gray-500">No media shared yet.</p>
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
