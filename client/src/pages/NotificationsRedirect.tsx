import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'

/**
 * /notifications route handler.
 *
 * The notifications UI lives in a global drawer (see `<NotificationsDrawer />`
 * mounted by `Layout.tsx`), not a dedicated page — so the URL was previously
 * unrouted and 404'd. Email/notification deep-links and bookmarks to
 * `/notifications` died at the door (flagged by an external prod audit).
 *
 * This redirect handler opens the drawer and immediately navigates to the
 * caller's preferred landing surface (`/home` for logged-in users, `/` for
 * guests) so the URL has a real destination. The drawer overlays the
 * destination so the user lands on a sensible page with the notifications
 * panel already open.
 *
 * Why `replace: true`: the deep-link URL was a transient — the user almost
 * certainly wants the back button to take them to the page BEFORE the
 * email/bookmark click, not back to /notifications (which would just
 * re-redirect).
 */
export default function NotificationsRedirect() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const toggleDrawer = useNotificationStore((s) => s.toggleDrawer)

  useEffect(() => {
    toggleDrawer(true)
    navigate(user ? '/home' : '/', { replace: true })
  }, [navigate, toggleDrawer, user])

  return null
}
