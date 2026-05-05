import { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * BrandIdRedirect — resolves /brands/id/:id to the canonical /brands/:slug.
 *
 * Mirrors the id-fallback pattern other roles use (/players/id/:id,
 * /clubs/id/:id, /umpires/id/:id). Brands key on slug, not username, so
 * a one-off resolver is needed: query brands.profile_id → brands.slug,
 * then redirect.
 *
 * Used by notifications and friend lists where we know the brand's
 * profile id but not the slug. Keeps brand notification deep-links from
 * 404-ing.
 */
export default function BrandIdRedirect() {
  const { id } = useParams<{ id: string }>()
  const [slug, setSlug] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) {
      setNotFound(true)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('slug')
        .eq('profile_id', id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        logger.error('[BrandIdRedirect] failed to resolve brand id', error)
        setNotFound(true)
        return
      }
      if (!data?.slug) {
        setNotFound(true)
        return
      }
      setSlug(data.slug)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFound) {
    return <Navigate to="/marketplace" replace />
  }
  if (slug) {
    return <Navigate to={`/brands/${slug}`} replace />
  }
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Loading brand" />
    </div>
  )
}
