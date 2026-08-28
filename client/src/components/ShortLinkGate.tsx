/**
 * Mounts the short-link resolver INSTEAD of the app shell on /l/<code>.
 *
 * Sits above TermsGate / AgeGate / ProtectedRoute / Layout so a visitor who
 * tapped a bio link sees no consent wall, no header and no auth redirect
 * before they are sent to the real destination.
 */

import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { isShortLinkPath } from '@/lib/shortLinks'
import ShortLinkRedirect from '@/pages/ShortLinkRedirect'

export default function ShortLinkGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  if (isShortLinkPath(pathname)) return <ShortLinkRedirect />
  return <>{children}</>
}
