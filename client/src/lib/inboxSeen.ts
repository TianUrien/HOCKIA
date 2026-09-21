import { useEffect, useMemo, useState } from 'react'
import { useNotificationStore } from '@/lib/notifications'
import { useUnreadMessages } from '@/hooks/useUnreadMessages'

/**
 * Inbox tab dot (design rule 2026-09-20): on when there are unread messages
 * or unseen activity/requests; never a number. Activity and requests count
 * as "seen" once the member opens that segment — not when they merely land
 * on Inbox — so the last-opened time is remembered per browser. Messages
 * clear only when the thread is actually read.
 */
const KEY = 'hockia-inbox-seen'
const EVENT = 'hockia:inbox-seen'

type Segment = 'activity' | 'requests'

function readSeen(): Partial<Record<Segment, string>> {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<Record<Segment, string>>) : {}
  } catch {
    return {}
  }
}

export function markInboxSegmentSeen(segment: Segment) {
  try {
    const next = { ...readSeen(), [segment]: new Date().toISOString() }
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode / storage blocked — the dot simply stays until read.
  }
  window.dispatchEvent(new Event(EVENT))
}

function useSeen() {
  const [seen, setSeen] = useState(() => (typeof window === 'undefined' ? {} : readSeen()))
  useEffect(() => {
    const handler = () => setSeen(readSeen())
    window.addEventListener(EVENT, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [])
  return seen
}

export function useInboxDot(): boolean {
  const { count: unreadMessages } = useUnreadMessages()
  const notifications = useNotificationStore((s) => s.notifications)
  const seen = useSeen()
  return useMemo(() => {
    if (unreadMessages > 0) return true
    return notifications.some((n) => {
      if (n.readAt || n.clearedAt) return false
      const stamp = n.kind === 'friend_request_received' ? seen.requests ?? seen.activity : seen.activity
      return !stamp || n.createdAt > stamp
    })
  }, [unreadMessages, notifications, seen])
}
