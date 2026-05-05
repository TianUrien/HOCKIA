import { useState } from 'react'
import { Calendar, ExternalLink, Film, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import Button from './Button'
import ConfirmActionModal from './ConfirmActionModal'
import FullGameVideoFormModal from './FullGameVideoFormModal'
import Skeleton from './Skeleton'
import { useToastStore } from '@/lib/toast'
import { useFullGameVideos, type FullGameVideo } from '@/hooks/useFullGameVideos'
import { cn } from '@/lib/utils'

/**
 * FullGameVideosSection — owner-side list + CRUD for full match footage.
 *
 * Mounted inside MediaTab on PLAYER profiles only, beneath the highlight
 * video block. Highlight = quick first impression; full game videos =
 * deeper evidence for clubs/coaches.
 *
 * v1 ships owner mode only. Visitor surface lands in PR 2 — RLS already
 * filters rows correctly, but the visitor list needs separate UX
 * decisions (no add CTA, hidden empty state).
 *
 * Sort comes from the hook: match_date DESC NULLS LAST, created_at DESC.
 *
 * Watch flow is an external link (target="_blank"). Full games are 60+
 * minutes of unedited footage; embedding inline would dominate the
 * profile and waste bandwidth.
 */

interface FullGameVideosSectionProps {
  /** Player's profile id. Required — section only renders for players. */
  playerUserId: string
  /** When true, no add/edit/delete affordances render. PR 2 ships the
   *  full visitor surface; for v1 this also short-circuits if the section
   *  ever gets mounted in readOnly mode by accident. */
  readOnly?: boolean
}

function formatMatchDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function buildContextLine(v: FullGameVideo): string | null {
  const parts: string[] = []
  if (v.competition) parts.push(v.competition)
  const date = formatMatchDate(v.match_date)
  if (date) parts.push(date)
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildPlayerLine(v: FullGameVideo): string | null {
  const parts: string[] = []
  if (v.position_played) parts.push(`Position: ${v.position_played}`)
  if (v.shirt_number !== null && v.shirt_number !== undefined) parts.push(`Shirt #${v.shirt_number}`)
  if (v.minutes_played !== null && v.minutes_played !== undefined) parts.push(`${v.minutes_played} minutes`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildOpponentLine(v: FullGameVideo): string | null {
  if (v.player_team && v.opponent_team) return `${v.player_team} vs ${v.opponent_team}`
  if (v.player_team) return v.player_team
  if (v.opponent_team) return `vs ${v.opponent_team}`
  return null
}

export default function FullGameVideosSection({
  playerUserId,
  readOnly = false,
}: FullGameVideosSectionProps) {
  const { videos, isLoading, addVideo, updateVideo, deleteVideo } = useFullGameVideos(playerUserId)
  const { addToast } = useToastStore()
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingVideo, setEditingVideo] = useState<FullGameVideo | null>(null)
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const openAdd = () => {
    setEditingVideo(null)
    setShowFormModal(true)
  }
  const openEdit = (v: FullGameVideo) => {
    setEditingVideo(v)
    setShowFormModal(true)
  }
  const closeFormModal = () => {
    setShowFormModal(false)
    setEditingVideo(null)
  }

  const handleSubmit = async (input: Parameters<typeof updateVideo>[1]) => {
    if (editingVideo) {
      return updateVideo(editingVideo.id, input)
    }
    const created = await addVideo(input as Omit<FullGameVideo, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'display_order'>)
    return created !== null
  }

  const confirmDelete = async () => {
    if (!deletingVideoId) return
    setIsDeleting(true)
    const ok = await deleteVideo(deletingVideoId)
    setIsDeleting(false)
    if (ok) {
      addToast('Match video removed.', 'success')
      setDeletingVideoId(null)
    } else {
      addToast('Could not remove video. Please try again.', 'error')
    }
  }

  // Visitor mode + zero videos → hide the entire section (no orphan
  // header). Owner mode keeps the header so the empty-state nudge can
  // motivate the first add. RLS filters which rows the visitor sees;
  // an anonymous / player visitor sees only `visibility='public'` rows,
  // a club / coach visitor sees public + recruiters.
  if (readOnly && !isLoading && videos.length === 0) {
    return null
  }

  // Subtitle differs by mode: owner gets the instructive prompt; visitor
  // gets a neutral framing that names the artifact without framing it as
  // a quality judgement.
  const subtitle = readOnly
    ? 'Unedited match videos for deeper context.'
    : 'Unedited match videos so clubs can see you in real game conditions.'

  return (
    <section className="mt-6" data-testid="full-game-videos-section">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Full match footage</h3>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
        {!readOnly && (
          <Button
            onClick={openAdd}
            variant="outline"
            className="flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add video
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-xl" variant="rectangular" />
          <Skeleton className="h-24 w-full rounded-xl" variant="rectangular" />
        </div>
      ) : videos.length === 0 ? (
        readOnly ? null : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <Film className="h-5 w-5 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-900">No match videos yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
              Add full match footage so clubs can evaluate you in real game conditions.
            </p>
          </div>
        )
      ) : (
        <ul className="space-y-2">
          {videos.map((v) => (
            <FullGameVideoRow
              key={v.id}
              video={v}
              readOnly={readOnly}
              onEdit={() => openEdit(v)}
              onDelete={() => setDeletingVideoId(v.id)}
            />
          ))}
        </ul>
      )}

      <FullGameVideoFormModal
        isOpen={showFormModal}
        onClose={closeFormModal}
        initialValue={editingVideo}
        onSubmit={handleSubmit}
      />

      <ConfirmActionModal
        isOpen={Boolean(deletingVideoId)}
        title="Remove this match video?"
        description="The video link will be removed from your profile. You can always add it again later."
        confirmLabel="Remove"
        confirmTone="danger"
        confirmLoading={isDeleting}
        loadingLabel="Removing…"
        onConfirm={confirmDelete}
        onClose={() => {
          if (!isDeleting) setDeletingVideoId(null)
        }}
      />
    </section>
  )
}

interface FullGameVideoRowProps {
  video: FullGameVideo
  readOnly: boolean
  onEdit: () => void
  onDelete: () => void
}

function FullGameVideoRow({ video, readOnly, onEdit, onDelete }: FullGameVideoRowProps) {
  const opponentLine = buildOpponentLine(video)
  const contextLine = buildContextLine(video)
  const playerLine = buildPlayerLine(video)
  const isRecruiterOnly = video.visibility === 'recruiters'

  return (
    <li
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      data-testid={`full-game-video-row-${video.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Full match video
            </p>
            {isRecruiterOnly && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700',
                )}
                title="Visible to clubs and coaches only"
              >
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                Recruiters only
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-gray-900" title={video.match_title}>
            {video.match_title}
          </p>
          {opponentLine && <p className="mt-0.5 text-xs text-gray-700">{opponentLine}</p>}
          {contextLine && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {contextLine}
            </p>
          )}
          {playerLine && <p className="mt-0.5 text-xs text-gray-500">{playerLine}</p>}
          {video.notes && (
            <p className="mt-2 rounded-md bg-gray-50 px-2 py-1 text-xs italic text-gray-600">
              {video.notes}
            </p>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Edit video"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove video"
              title="Remove"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <a
        href={video.video_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90"
      >
        Watch video
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </li>
  )
}
