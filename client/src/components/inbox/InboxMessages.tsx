import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { ConversationSkeleton } from '@/components/Skeleton'
import { identityLine } from '@/lib/identity'
import { formatInboxTime } from '@/lib/inboxTime'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useClubInboxMeta } from '@/hooks/useClubInbox'
import { clubInboxRoleLine, inboxWaitingNotice } from '@/lib/clubInbox'
import { firstNameOf } from '@/lib/invites'
import { recruitingPreview } from '@/lib/signing'

interface ConversationRpcRow {
  conversation_id: string
  other_participant_id: string
  other_participant_name: string | null
  other_participant_username: string | null
  other_participant_avatar: string | null
  other_participant_role: string | null
  last_message_content: string | null
  last_message_sent_at: string | null
  last_message_sender_id: string | null
  unread_count: number | null
  conversation_created_at: string
  conversation_updated_at: string
  conversation_last_message_at: string | null
  has_more?: boolean
}

const PAGE_SIZE = 50

const inboxConversationsKey = (userId: string) => ['inbox-conversations', userId] as const

interface InboxMessagesProps {
  onCompose: () => void
}

/**
 * Inbox › Messages (Figma 100:278): a filled grey Search field, then one
 * thread per row (List item / Conversation 494:2377) — crest/avatar 52,
 * name + date (clock today, day-first before), role line, last message, and
 * a brand-purple dot (never a number) while unread. Tapping opens
 * the conversation. Reads the same `get_user_conversations` RPC as the
 * desktop Messages page.
 *
 * Club v2 on phones (Figma D1.19 353:502; DEV NOTE 355:914): every row says
 * "Player · position", plus "Applied" when the person applied to one of the
 * club's roles; an amber dot marks conversations the club has never written
 * in, and an amber notice counts them (hidden at 0). Players see none of it.
 */
export function InboxMessages({ onCompose }: InboxMessagesProps) {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [query, setQuery] = useState('')
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const clubV2 = role === 'club' && isPhone

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: inboxConversationsKey(userId ?? 'anon'),
    enabled: Boolean(userId),
    // Coming back from a chat must show the message you just sent: refetch on
    // every mount (one small RPC), keep the cached rows meanwhile.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('get_user_conversations', {
        p_user_id: userId!,
        p_limit: PAGE_SIZE,
      })
      if (error) throw error
      return (rows ?? []) as ConversationRpcRow[]
    },
  })

  const { data: meta } = useClubInboxMeta(userId, data ?? [], clubV2)
  const notice = useMemo(() => (clubV2 && meta ? inboxWaitingNotice([...meta.values()]) : null), [clubV2, meta])

  const filtered = useMemo(() => {
    const rows = data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        (r.other_participant_name ?? '').toLowerCase().includes(q) ||
        (r.last_message_content ?? '').toLowerCase().includes(q),
    )
  }, [data, query])

  return (
    <section aria-label="Messages">
      <div className="px-5 pb-1.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 w-full rounded-[12px] bg-surface-muted pl-10 pr-10 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/40 [&::-webkit-search-cancel-button]:hidden"
            data-testid="inbox-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-3"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {notice && !query && (
        <div className="px-5 pb-2">
          <div className="flex items-center gap-3 rounded-2xl bg-[#fdf1e4] py-3 pl-3.5 pr-3" role="status" data-testid="club-inbox-waiting-notice">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-[#b45309]"><Clock className="h-5 w-5" strokeWidth={2} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-row font-semibold text-ink-1">{notice.title}</span>
              {notice.sub && <span className="block text-secondary text-[#b45309]">{notice.sub}</span>}
            </span>
          </div>
        </div>
      )}

      {isLoading ? (
        <div>
          <ConversationSkeleton />
          <ConversationSkeleton />
          <ConversationSkeleton />
        </div>
      ) : isError ? (
        <div className="px-5 py-10 text-center">
          <p className="text-row font-semibold text-ink-1">Could not load your messages</p>
          <button type="button" onClick={() => void refetch()} className={buttonClassName({ variant: 'secondary', size: 'small', radius: 'rounded-full', className: 'mt-3' })}>
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-row font-semibold text-ink-1">{query ? 'No conversations match' : 'No messages yet'}</p>
          <p className="mt-1 text-secondary text-ink-2">
            {query ? 'Try another name.' : role === 'club' ? 'Messages from players, coaches and clubs show up here.' : 'Clubs answer messages far more often than they update applications.'}
          </p>
          {!query && (
            <button type="button" onClick={onCompose} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'mt-4' })}>
              New message
            </button>
          )}
        </div>
      ) : (
        <ul>
          {filtered.map((row) => {
            const unread = Number(row.unread_count ?? 0) > 0
            const name = row.other_participant_name ?? row.other_participant_username ?? 'HOCKIA member'
            const mine = row.last_message_sender_id === userId
            // Recruiting lines the server posts as the club are reworded for
            // the club and never carry the "You:" prefix (lib/signing).
            const line = row.last_message_content ? recruitingPreview(row.last_message_content, { isMine: mine, otherFirstName: firstNameOf(row.other_participant_name, '') }) : null
            const preview = line ? `${mine && !line.system ? 'You: ' : ''}${line.text}` : 'Say hello'
            const m = clubV2 ? meta?.get(row.conversation_id) : undefined
            const roleLine = m ? clubInboxRoleLine(row.other_participant_role, m.detail, m.applied) : identityLine(row.other_participant_role)
            return (
              <li key={row.conversation_id} className="group">
                {/* List item / Conversation (Figma 494:2377): avatar 52, name +
                    date, meta, preview; the divider starts at the text. */}
                <button
                  type="button"
                  onClick={() => navigate(`/messages/${row.conversation_id}`)}
                  className="flex w-full items-center gap-3 pl-4 text-left transition-colors active:bg-surface-muted"
                  data-testid="conversation-row"
                >
                  <EntityAvatar src={row.other_participant_avatar} name={name} role={row.other_participant_role} size={52} />
                  <span className="min-w-0 flex-1 border-b border-line py-3 pr-4 group-last:border-b-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{name}</span>
                      <span className="shrink-0 text-secondary text-ink-3" data-testid="conversation-date">{formatInboxTime(row.conversation_last_message_at ?? row.last_message_sent_at)}</span>
                    </span>
                    <span className="block truncate text-secondary text-ink-2">{roleLine}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-[14px] leading-[19px]', unread ? 'font-medium text-ink-1' : 'text-ink-2')}>{preview}</span>
                      {/* Dot, never a number. Amber = the club owes a first
                          reply (club only); brand purple = unread. */}
                      {m?.waiting ? (
                        <span aria-label="Waiting for your first reply" className="h-2 w-2 shrink-0 rounded-full bg-[#b45309]" data-testid="inbox-waiting-dot" />
                      ) : unread ? (
                        <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-hockia-primary" data-testid="inbox-unread-dot" />
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
