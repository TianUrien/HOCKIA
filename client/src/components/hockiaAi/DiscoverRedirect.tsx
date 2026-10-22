import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

/**
 * /discover and /discovery are no longer a page (one sheet, founder ruling
 * 2026-10-22). Old links, shared URLs and native builds that still navigate
 * there land on Home with the Hockia AI sheet open; a ?q= goes into the
 * composer for the member to send.
 */
export function DiscoverRedirect() {
  const [params] = useSearchParams()
  const q = params.get('q')?.trim() ?? ''
  const show = useHockiaAiSheet((s) => s.show)
  useEffect(() => { show('link', 'chat', q ? { text: q, send: false } : null) }, [show, q])
  return <Navigate to="/home" replace />
}
