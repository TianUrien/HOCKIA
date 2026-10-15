/**
 * RouteMeta — sets canonical, og:url, description, robots and (for static
 * pages) the title on every navigation. Mounted BEFORE <Routes> so its
 * effect runs first and any page-level hook (useDocumentTitle,
 * usePublicProfileMeta, the opportunity page) still wins by running after.
 * See lib/seo/routeMeta.ts for the why.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { applyRouteMeta } from '@/lib/seo/applyRouteMeta'

export function RouteMeta() {
  const { pathname } = useLocation()
  useEffect(() => {
    applyRouteMeta(pathname)
  }, [pathname])
  return null
}
