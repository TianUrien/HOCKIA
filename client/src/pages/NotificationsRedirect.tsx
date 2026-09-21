import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'

/**
 * /notifications deep-link handler.
 *
 * Activity now has a real screen — Inbox › Activity (Figma 03 Player) — so
 * email and push deep-links land there instead of opening the drawer over
 * Home. `replace: true` keeps the transient URL out of history so Back
 * returns to wherever the member was before the tap.
 */
export default function NotificationsRedirect() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  useEffect(() => {
    navigate(user ? '/inbox/activity' : '/', { replace: true })
  }, [navigate, user])

  return null
}
