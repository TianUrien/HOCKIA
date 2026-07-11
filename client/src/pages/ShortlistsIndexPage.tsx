/**
 * ShortlistsIndexPage — P1.5 (Spec G.8).
 *
 * Lists the recruiter's shortlists with item counts + default-list
 * badge. Surface for: jumping into a list, renaming, deleting, and
 * creating a new one. Owner-only via RLS — nothing renders for
 * anonymous viewers.
 *
 * Routes:
 *   /dashboard/shortlists                → this page
 *   /dashboard/shortlists/:id            → ShortlistDetailPage
 *
 * The pre-existing /dashboard/saved (single-bucket SavedCandidatesPage)
 * stays mounted unchanged; it now reads from the default list since
 * the schema upgrade put every legacy row there.
 */

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BookmarkCheck, Plus, Star, Trash2, Pencil, Check, X } from 'lucide-react'
import Header from '@/components/Header'
import { useAuthStore } from '@/lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useShortlists, type ShortlistWithCount } from '@/hooks/useShortlists'

export default function ShortlistsIndexPage() {
  useDocumentTitle('Shortlists')
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { lists, loading, error, create, rename, remove, setDefault } = useShortlists()
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 pt-24 pb-12 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign in to manage shortlists</h1>
          <p className="text-gray-600 mb-6">Group players you're scouting and triage them later.</p>
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

  const handleCreate = async () => {
    if (!draftName.trim()) return
    setBusy(true)
    const created = await create(draftName)
    setBusy(false)
    if (created) {
      setDraftName('')
      setCreating(false)
      navigate(`/dashboard/shortlists/${created.id}`)
    }
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

        <header className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BookmarkCheck className="w-6 h-6 text-hockia-primary" />
              Shortlists
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Group players you're scouting. Only you see these lists.
            </p>
          </div>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-hockia-primary text-white text-sm font-semibold hover:bg-[#6b1de0] transition-colors"
            >
              <Plus className="w-4 h-4" />
              New list
            </button>
          )}
        </header>

        {creating && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-hockia-primary/30 bg-hockia-primary/5 p-3">
            <input
              autoFocus
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Women's pre-season trials"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-hockia-primary/30 focus:border-hockia-primary focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') { setCreating(false); setDraftName('') }
              }}
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy || !draftName.trim()}
              className="px-3 py-2 rounded-lg bg-hockia-primary text-white text-sm font-semibold hover:bg-[#6b1de0] disabled:bg-gray-300 transition-colors"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setDraftName('') }}
              className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && lists.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <ul className="space-y-3">
            {lists.map((list) => (
              <ShortlistRow
                key={list.id}
                list={list}
                onOpen={() => navigate(`/dashboard/shortlists/${list.id}`)}
                onRename={(name) => void rename(list.id, name)}
                onDelete={() => {
                  // F8 (QA): confirm before destructive delete. List +
                  // all items disappear with no undo, so a one-tap
                  // confirm is the right safety. Native confirm beats
                  // a modal here for terseness and a11y; can upgrade
                  // to a styled dialog later if QA flags this too.
                  const msg = list.item_count > 0
                    ? `Delete "${list.name}" and remove ${list.item_count} ${list.item_count === 1 ? 'player' : 'players'} from this list? This can't be undone.`
                    : `Delete "${list.name}"?`
                  if (window.confirm(msg)) {
                    void remove(list.id)
                  }
                }}
                onSetDefault={() => void setDefault(list.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  list: ShortlistWithCount
  onOpen: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onSetDefault: () => void
}

function ShortlistRow({ list, onOpen, onRename, onDelete, onSetDefault }: RowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(list.name)

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) onRename(trimmed)
    setEditing(false)
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        {editing ? (
          <input
            autoFocus
            type="text"
            aria-label={`Rename shortlist ${list.name}`}
            placeholder="Shortlist name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(list.name); setEditing(false) }
            }}
            className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-hockia-primary/30 focus:border-hockia-primary focus:outline-none"
          />
        ) : (
          <Link to={`/dashboard/shortlists/${list.id}`} className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-gray-900 truncate">{list.name}</span>
              {list.is_default && (
                <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold tracking-wider text-hockia-primary bg-hockia-primary/10 rounded-full px-2 py-0.5">
                  <Star className="w-3 h-3 fill-current" />
                  Default
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {list.item_count} {list.item_count === 1 ? 'player' : 'players'}
            </p>
          </Link>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <>
              <button
                type="button"
                onClick={commitRename}
                aria-label="Save name"
                className="p-1.5 rounded-md text-hockia-primary hover:bg-hockia-primary/10"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { setDraft(list.name); setEditing(false) }}
                aria-label="Cancel rename"
                className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              {!list.is_default && (
                <button
                  type="button"
                  onClick={onSetDefault}
                  aria-label="Make this the default list"
                  title="Make default — quick-saves land here"
                  className="p-1.5 rounded-md text-gray-400 hover:text-hockia-primary hover:bg-hockia-primary/10"
                >
                  <Star className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Rename"
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {!list.is_default && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label="Delete"
                  className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onOpen}
                className="ml-1 px-3 py-1.5 rounded-lg bg-gray-100 text-xs font-semibold text-gray-700 hover:bg-gray-200"
              >
                Open
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
      <BookmarkCheck className="w-10 h-10 text-gray-400 mx-auto mb-3" />
      <h2 className="text-lg font-semibold text-gray-900 mb-1">No shortlists yet</h2>
      <p className="text-sm text-gray-600 mb-4">
        Save a player from Community or create a list to group your prospects.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hockia-primary text-white text-sm font-semibold hover:bg-[#6b1de0]"
      >
        <Plus className="w-4 h-4" />
        Create your first list
      </button>
    </div>
  )
}
