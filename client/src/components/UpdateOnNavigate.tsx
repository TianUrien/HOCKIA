import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { applyPendingUpdate } from '@/lib/swUpdate'

/**
 * A move to another screen is a safe moment to apply a version that is
 * waiting behind the update prompt: the screen the member was on is gone
 * anyway, and the reload lands on the screen they asked for. Skipped while
 * the new screen holds typed text (see applyPendingUpdate).
 */
export default function UpdateOnNavigate() {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    applyPendingUpdate()
  }, [pathname])
  return null
}
