import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, CircleDot, HelpCircle, Loader2, PenLine, Search, Trash2, X } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { hapticLight, hapticSelection } from '@/lib/haptics'
import {
  deleteAllChats, deleteChat, groupChats, listChats, matchesChatSearch,
  type AiChatKind, type AiChatRow,
} from '@/lib/aiChats'

const KIND_ICON: Record<AiChatKind, typeof Check> = {
  apply: Check,
  search: Search,
  question: HelpCircle,
  profile: PenLine,
  role: CircleDot,
}
const DELETE_W = 88

interface Props {
  onBack: () => void
  onNewChat: () => void
  onClose: () => void
  /** A conversation row: show it in the chat. Resolves once it's loaded. */
  onOpenChat: (row: AiChatRow) => Promise<void>
  /** An action row (application sent, profile filled): go to what it changed. */
  onOpenLink: (link: string) => void
}

/**
 * Chats (handoff C2, Figma 180:344): Today / This week, each row says what
 * happened. Swipe a row left to delete it (a Delete button is reachable by
 * keyboard and on hover too); "Delete all chats" asks first. Private, kept
 * 90 days (ruling 2026-10-18).
 */
export function ChatHistory({ onBack, onNewChat, onClose, onOpenChat, onOpenLink }: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [rows, setRows] = useState<AiChatRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setRows(null)
    listChats().then(setRows).catch((err) => { logger.warn('[ChatHistory] list failed', err); setFailed(true) })
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupChats((rows ?? []).filter((r) => matchesChatSearch(r, query))), [rows, query])

  const remove = async (row: AiChatRow) => {
    void hapticLight()
    setRows((rs) => rs?.filter((r) => r.id !== row.id) ?? rs)
    try {
      await deleteChat(row.id)
    } catch (err) {
      logger.warn('[ChatHistory] delete failed', err)
      load()
    }
  }

  const removeAll = async () => {
    if (!userId) return
    setDeletingAll(true)
    try {
      await deleteAllChats(userId)
      setRows([])
      setConfirmAll(false)
    } catch (err) {
      logger.warn('[ChatHistory] delete all failed', err)
      load()
    } finally {
      setDeletingAll(false)
    }
  }

  const open = async (row: AiChatRow) => {
    if (opening) return
    void hapticSelection()
    if (row.link) { onOpenLink(row.link); return }
    setOpening(row.id)
    setOpenFailed(false)
    try {
      await onOpenChat(row)
    } catch (err) {
      logger.warn('[ChatHistory] open failed', err)
      setOpenFailed(true)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="hockia-ai-history">
      <div className="flex h-11 shrink-0 items-center gap-2.5 px-4">
        <button type="button" onClick={onBack} className="-ml-1 flex min-h-[44px] items-center gap-0.5 text-[16px] leading-[22px] text-brand-primary" data-testid="hockia-ai-history-back">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} /> Chat
        </button>
        <button type="button" onClick={onNewChat} className="rounded-full bg-brand-primary px-3 py-[7px] text-[13px] font-semibold leading-[18px] text-white" data-testid="hockia-ai-new-chat">
          New chat
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-2" data-testid="hockia-ai-history-close">
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2.5">
        <h2 className="text-[28px] font-bold leading-[34px] tracking-[-0.01em] text-ink-1">Chats</h2>
        <label className="mt-1.5 flex items-center gap-2 rounded-[12px] bg-surface-subtle px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
          <span className="sr-only">Search chats</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
            data-testid="hockia-ai-history-search"
          />
        </label>

        {failed ? (
          <div className="py-10 text-center" data-testid="hockia-ai-history-error">
            <p className="text-[15px] text-ink-2">I couldn’t load your chats.</p>
            <button type="button" onClick={load} className="mt-2 text-secondary font-semibold text-brand-primary">Try again</button>
          </div>
        ) : rows === null ? (
          <div className="flex flex-col gap-3 pt-5" aria-label="Loading chats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="h-9 w-9 animate-pulse rounded-[10px] bg-surface-subtle" />
                <span className="h-4 flex-1 animate-pulse rounded bg-surface-subtle" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-[15px] leading-5 text-ink-2" data-testid="hockia-ai-history-empty">
            No chats yet. What you ask Hockia AI shows up here for 90 days.
          </p>
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-ink-2">No chats match “{query.trim()}”.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="pb-1 pt-3.5 text-[11px] font-semibold uppercase leading-[14px] text-ink-3">{g.label}</h3>
              <ul>
                {g.rows.map((r) => (
                  <ChatRow key={r.id} row={r} busy={opening === r.id} onOpen={() => void open(r)} onDelete={() => void remove(r)} />
                ))}
              </ul>
            </section>
          ))
        )}

        {openFailed && <p className="mt-2 text-secondary text-status-danger" role="alert">I couldn’t open that chat. Try again in a moment.</p>}

        <p className="pt-4 text-[12px] leading-4 text-ink-3">Chats are private to you. Delete any time.</p>
        {rows && rows.length > 0 && (
          confirmAll ? (
            <div className="mt-3 rounded-[16px] border border-line p-3" data-testid="hockia-ai-delete-all-confirm">
              <p className="text-[14px] leading-[19px] text-ink-1">Delete all {rows.length} {rows.length === 1 ? 'chat' : 'chats'}? This can’t be undone.</p>
              <div className="mt-2.5 flex gap-2">
                <button type="button" onClick={() => setConfirmAll(false)} className="flex-1 rounded-full border border-line py-2 text-[14px] font-semibold text-ink-1">Cancel</button>
                <button type="button" onClick={() => void removeAll()} disabled={deletingAll} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-status-danger py-2 text-[14px] font-semibold text-white" data-testid="hockia-ai-delete-all-yes">
                  {deletingAll && <Loader2 className="h-4 w-4 animate-spin" />} Delete all
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="mt-2 min-h-[44px] text-[14px] font-semibold text-status-danger" data-testid="hockia-ai-delete-all">
              Delete all chats
            </button>
          )
        )}
      </div>
    </div>
  )
}

/** One row; drag it left to show Delete (iOS swipe-to-delete). */
function ChatRow({ row, busy, onOpen, onDelete }: { row: AiChatRow; busy: boolean; onOpen: () => void; onDelete: () => void }) {
  const Icon = KIND_ICON[row.kind] ?? Search
  const [dx, setDx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const start = useRef<{ x: number; y: number; base: number } | null>(null)
  const moved = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, base: revealed ? -DELETE_W : 0 }
    moved.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const ddx = e.clientX - s.x
    if (!moved.current) {
      if (Math.abs(ddx) < 8 || Math.abs(ddx) < Math.abs(e.clientY - s.y)) return
      moved.current = true
      // A pointer that's already gone (cancelled touch) can't be captured; the drag still works.
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* no active pointer */ }
    }
    setDx(Math.min(0, Math.max(-DELETE_W * 1.4, s.base + ddx)))
  }
  const onPointerUp = () => {
    if (!start.current) return
    start.current = null
    if (!moved.current) return
    const show = dx < -DELETE_W / 2
    setRevealed(show)
    setDx(show ? -DELETE_W : 0)
  }
  const onClick = () => {
    if (moved.current) { moved.current = false; return }
    if (revealed) { setRevealed(false); setDx(0); return }
    onOpen()
  }

  return (
    <li className="group relative overflow-hidden" data-testid="hockia-ai-history-row" data-kind={row.kind}>
      <button
        type="button"
        onClick={onDelete}
        tabIndex={revealed ? 0 : -1}
        aria-hidden={!revealed}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-status-danger text-[14px] font-semibold text-white"
        style={{ width: DELETE_W }}
        data-testid="hockia-ai-history-swipe-delete"
      >
        Delete
      </button>
      <div
        className="relative flex items-center bg-white"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 220ms ease-out', touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left" data-testid="hockia-ai-history-open">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" strokeWidth={2.2} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold leading-[19px] text-ink-1">{row.title}</span>
            {row.summary && <span className="block truncate text-[13px] leading-[18px] text-ink-2">{row.summary}</span>}
          </span>
        </button>
        {/* Keyboard and pointer users: the same delete without swiping. */}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete chat: ${row.title}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity hover:text-status-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden"
          data-testid="hockia-ai-history-delete"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>
    </li>
  )
}
