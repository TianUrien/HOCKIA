/**
 * Saved Candidates — Phase 1 of the Career Snapshot + Shortlist initiative.
 *
 * Private list of players the current user has bookmarked via the Save
 * action on MemberTile / MemberPreviewModal / HeroIdentityCard. Owner-only.
 * The saved player is never notified, and these rows are not visible to
 * anyone except the saver (enforced via RLS on saved_profiles).
 *
 * Phase 1 scope: single bucket, no named lists, no fit scoring. Each
 * row shows enough facts to triage quickly + jump to the full profile
 * or remove the save. Named-list grouping comes in Phase 2 once usage
 * patterns are observable.
 */

import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BookmarkCheck, Trash2, ExternalLink } from 'lucide-react'
import HockeyContextLine from '@/components/recruiting/HockeyContextLine'
import Header from '@/components/Header'
import { Avatar, RoleBadge } from '@/components'
import ContextSwitcher from '@/components/recruiting/ContextSwitcher'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { getInitials } from '@/lib/utils'
import { useSavedProfilesList, useIsProfileSaved, type SavedProfileSummary } from '@/hooks/useSavedProfiles'

export default function SavedCandidatesPage() {
  const { user, profile } = useAuthStore()
  // Recruiters (club/coach) save "candidates"; everyone else (players,
  // umpires) saves mixed "profiles" — clubs, coaches, players they want
  // to revisit. Same list + data; only the framing changes. Mirrors the
  // SavedCandidatesCard variant copy.
  const isRecruiter = profile?.role === 'club' || profile?.role === 'coach'
  const noun = isRecruiter ? 'Saved Candidates' : 'Saved Profiles'
  useDocumentTitle(noun)
  const navigate = useNavigate()
  const { items, loading, error, refresh } = useSavedProfilesList()

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 pt-24 pb-12 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to view saved profiles</h1>
          <p className="text-gray-600 mb-6">Save people you discover and keep them organised for later.</p>
          <button
            type="button"
            onClick={() => navigate('/signin')}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white font-semibold hover:opacity-90"
          >
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-3xl mx-auto px-4 pt-20 pb-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookmarkCheck className="w-6 h-6 text-hockia-primary" />
            {noun}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {isRecruiter
              ? "Players you've saved from Community, search, or any profile. Only you can see this list."
              : "People you've saved from Community, search, or any profile. Only you can see this list."}
          </p>
          {/* Active recruiting context drives the Club Fit chip on
              each saved candidate row. Self-hides for non-recruiter
              roles. */}
          <div className="mt-3">
            <ContextSwitcher />
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error} —{' '}
            <button type="button" onClick={() => void refresh()} className="underline">
              try again
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState isRecruiter={isRecruiter} />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <SavedCandidateRow key={item.id} item={item} onRemoved={() => void refresh()} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EmptyState({ isRecruiter }: { isRecruiter: boolean }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
        <BookmarkCheck className="w-7 h-7 text-hockia-primary" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        {isRecruiter ? 'No saved candidates yet' : 'No saved profiles yet'}
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        {isRecruiter
          ? 'Tap the bookmark icon on any player card in Community to save them here.'
          : 'Tap the bookmark icon on any profile in Community to save them here.'}
      </p>
      <Link
        to="/community"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white text-sm font-semibold hover:opacity-90"
      >
        Browse Community
      </Link>
    </div>
  )
}

function SavedCandidateRow({ item, onRemoved }: { item: SavedProfileSummary; onRemoved: () => void }) {
  const navigate = useNavigate()
  const savedState = useIsProfileSaved(item.profile?.id ?? null)
  const profile = item.profile

  if (!profile) {
    // Edge case: the saved profile was deleted but the row remains
    // (FK is ON DELETE CASCADE, so this shouldn't really happen — but
    // be safe). Show a neutral fallback with the saved row id so the
    // user can still remove it.
    return (
      <li className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        This player is no longer available on HOCKIA.
      </li>
    )
  }

  const profileRoute = (() => {
    if (profile.role === 'club') return `/clubs/id/${profile.id}`
    if (profile.role === 'coach') return `/coaches/id/${profile.id}`
    if (profile.role === 'umpire') return `/umpires/id/${profile.id}`
    return `/players/id/${profile.id}`
  })()

  const handleRemove = async () => {
    await savedState.toggle()
    onRemoved()
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 flex items-center gap-3 hover:border-gray-300 transition-colors">
      <button
        type="button"
        onClick={() => navigate(profileRoute)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
        aria-label={`Open ${profile.full_name ?? 'profile'}`}
      >
        <Avatar
          src={profile.avatar_url}
          initials={getInitials(profile.full_name)}
          alt={profile.full_name ?? ''}
          role={profile.role}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{profile.full_name ?? 'Unnamed'}</h3>
            <RoleBadge role={profile.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
          </div>
          {/* F12 (QA): consistency with the new ShortlistDetailPage —
              both surfaces now use HockeyContextLine (club ·
              competition · position) so users see the same row shape
              regardless of which entry point they used. */}
          <HockeyContextLine
            clubName={profile.current_club}
            competitionName={null}
            position={profile.position}
            className="mt-1"
          />
        </div>
        <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      <button
        type="button"
        onClick={handleRemove}
        disabled={savedState.mutating}
        className="ml-2 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
        aria-label={`Remove ${profile.full_name} from saved`}
        title="Remove from saved"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  )
}
