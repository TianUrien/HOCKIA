import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ConversationSkeleton } from '@/components/Skeleton'
import { identityLine } from '@/lib/identity'
import { formatInboxTime } from '@/lib/inboxTime'
import { cn } from '@/lib/utils'

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
 * Inbox › Messages (Figma 100:278): one thread per row — crest/avatar,
 * name + time, role line, last message, purple unread dot. Tapping opens
 * the conversation. Reads the same `get_user_conversations` RPC as the
 * desktop Messages page.
 */
export function InboxMessages({ onCompose }: InboxMessagesProps) {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [query, setQuery] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: inboxConversationsKey(userId ?? 'anon'),
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('get_user_conversations', {
        p_user_id: userId!,
        p_limit: PAGE_SIZE,
      })
      if (error) throw error
      return (rows ?? []) as ConversationRpcRow[]
    },
  })

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
      <div className="px-5 pb-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={2} />
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
            className="h-9 w-full rounded-[10px] bg-surface-grouped pl-9 pr-9 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-3"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {isLoading ? (
        <div>
          <ConversationSkeleton />
          <ConversationSkeleton />
          <ConversationSkeleton />
        </div>
      ) : isError ? (
        <div className="px-5 py-10 text-center">
          <p className="text-row font-semibold text-ink-1">Could not load your messages</p>
          <button type="button" onClick={() => void refetch()} className="mt-3 rounded-full bg-surface-grouped px-4 py-2 text-secondary font-semibold text-ink-1">
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-row font-semibold text-ink-1">{query ? 'No conversations match' : 'No messages yet'}</p>
          <p className="mt-1 text-secondary text-ink-2">
            {query ? 'Try another name.' : 'Clubs answer messages far more often than they update applications.'}
          </p>
          {!query && (
            <button type="button" onClick={onCompose} className="mt-4 rounded-full bg-hockia-primary px-5 py-2.5 text-row font-semibold text-white">
              New message
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {filtered.map((row) => {
            const unread = Number(row.unread_count ?? 0) > 0
            const name = row.other_participant_name ?? row.other_participant_username ?? 'HOCKIA member'
            const mine = row.last_message_sender_id === userId
            const preview = row.last_message_content ? `${mine ? 'You: ' : ''}${row.last_message_content}` : 'Say hello'
            return (
              <li key={row.conversation_id}>
                <button
                  type="button"
                  onClick={() => navigate(`/messages/${row.conversation_id}`)}
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors active:bg-surface-muted"
                >
                  <EntityAvatar src={row.other_participant_avatar} name={name} role={row.other_participant_role} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-row font-semibold text-ink-1">{name}</span>
                      <span className="shrink-0 text-secondary text-ink-4">{formatInboxTime(row.conversation_last_message_at ?? row.last_message_sent_at)}</span>
                    </span>
                    <span className="block truncate text-secondary text-ink-2">{identityLine(row.other_participant_role)}</span>
                    <span className={cn('block truncate text-secondary', unread ? 'font-medium text-ink-1' : 'text-ink-2')}>{preview}</span>
                  </span>
                  {unread && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-hockia-primary" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
