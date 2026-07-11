import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Link2, Loader2, RefreshCcw, Search, UserPlus, X } from 'lucide-react'
import Modal from '@/components/Modal'
import { Avatar, RoleBadge } from '@/components'
import { useToastStore } from '@/lib/toast'
import {
  buildClubInviteUrl,
  createClubInviteLink,
  inviteClubMember,
  revokeClubInviteLink,
  searchInvitableMembers,
  type MemberSearchResult,
} from '@/lib/clubMembership'

interface InviteMembersModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called after at least one invite was sent, so the parent can refresh. */
  onInvited?: () => void
}

type Tab = 'link' | 'person'

export default function InviteMembersModal({ isOpen, onClose, onInvited }: InviteMembersModalProps) {
  const { addToast } = useToastStore()
  const [tab, setTab] = useState<Tab>('link')

  // ── Invite link ───────────────────────────────────────────────────
  const [token, setToken] = useState<string | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const ensureLink = useCallback(async () => {
    setLinkLoading(true)
    const res = await createClubInviteLink()
    setLinkLoading(false)
    if (res.success && res.token) {
      setToken(res.token)
    } else {
      addToast(res.error ?? 'Could not create the invite link.', 'error')
    }
  }, [addToast])

  // Get-or-create the link the first time the user opens the modal on the link tab.
  useEffect(() => {
    if (isOpen && tab === 'link' && token === null && !linkLoading) {
      void ensureLink()
    }
  }, [isOpen, tab, token, linkLoading, ensureLink])

  // Reset transient state when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setCopied(false)
      setQuery('')
      setResults([])
      setInvited(new Set())
    }
  }, [isOpen])

  const inviteUrl = token ? buildClubInviteUrl(token) : ''

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      addToast('Could not copy. Long-press the link to copy it.', 'error')
    }
  }

  const handleRegenerate = async () => {
    setLinkLoading(true)
    await revokeClubInviteLink()
    const res = await createClubInviteLink()
    setLinkLoading(false)
    if (res.success && res.token) {
      setToken(res.token)
      setCopied(false)
      addToast('New invite link generated. The old one no longer works.', 'success')
    } else {
      addToast(res.error ?? 'Could not regenerate the link.', 'error')
    }
  }

  // ── Invite a person ───────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [invited, setInvited] = useState<Set<string>>(new Set())
  const searchSeq = useRef(0)

  useEffect(() => {
    if (tab !== 'person') return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++searchSeq.current
    const handle = setTimeout(async () => {
      const data = await searchInvitableMembers(q)
      if (seq === searchSeq.current) {
        setResults(data)
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [query, tab])

  const handleInvite = async (member: MemberSearchResult) => {
    setInvitingId(member.id)
    const res = await inviteClubMember(member.id)
    setInvitingId(null)
    if (res.success) {
      setInvited((prev) => new Set(prev).add(member.id))
      addToast(`Invitation sent to ${member.full_name ?? 'member'}.`, 'success')
      onInvited?.()
    } else {
      addToast(res.error ?? 'Could not send the invitation.', 'error')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md w-full" showClose={false}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">Invite members</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Build your club’s roster — players and coaches can accept to join.</p>

        {/* Segmented control */}
        <div className="flex p-1 mb-5 rounded-xl bg-gray-100">
          {([['link', 'Invite link', Link2], ['person', 'Invite a person', UserPlus]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'link' ? (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Share this link with your team. Anyone who opens it can accept and join your club.
            </p>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 min-w-0 flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                {linkLoading && !inviteUrl ? (
                  <span className="inline-flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating link…
                  </span>
                ) : (
                  <span className="truncate text-sm text-gray-700" title={inviteUrl}>{inviteUrl}</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!inviteUrl}
                className="inline-flex items-center gap-1.5 rounded-xl bg-hockia-primary px-4 text-sm font-semibold text-white transition hover:bg-[#6B20D4] disabled:opacity-50"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={linkLoading}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${linkLoading ? 'animate-spin' : ''}`} />
              Generate a new link
            </button>
          </div>
        ) : (
          <div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players and coaches by name"
                autoFocus
                className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-900 outline-none focus:border-hockia-primary/40 focus:ring-2 focus:ring-hockia-primary/15"
              />
            </div>

            <div className="min-h-[160px] max-h-[320px] overflow-y-auto -mx-1 px-1">
              {searching ? (
                <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching…
                </div>
              ) : query.trim().length < 2 ? (
                <p className="text-center text-sm text-gray-400 py-10">Type a name to find players and coaches.</p>
              ) : results.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-10">No players or coaches match “{query.trim()}”.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {results.map((m) => {
                    const isInvited = invited.has(m.id)
                    const meta = [m.position ? m.position.charAt(0).toUpperCase() + m.position.slice(1) : null, m.current_club || m.base_location].filter(Boolean).join(' · ')
                    return (
                      <li key={m.id} className="flex items-center gap-3 py-2.5">
                        <Avatar src={m.avatar_url} alt={m.full_name ?? ''} initials={m.full_name ? m.full_name.split(' ').map((n) => n[0]).join('') : '?'} size="md" role={m.role} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 text-sm truncate">{m.full_name}</span>
                            <RoleBadge role={m.role} />
                          </div>
                          {meta && <p className="text-xs text-gray-500 truncate mt-0.5">{meta}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleInvite(m)}
                          disabled={isInvited || invitingId === m.id}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                            isInvited
                              ? 'bg-green-50 text-green-600 cursor-default'
                              : 'bg-hockia-primary text-white hover:bg-[#6B20D4] disabled:opacity-60'
                          }`}
                        >
                          {invitingId === m.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isInvited ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : null}
                          {isInvited ? 'Invited' : 'Invite'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
