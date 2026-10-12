/**
 * BrandProfilePage
 *
 * Public profile page for a brand.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Header, Button } from '@/components'
import Breadcrumbs from '@/components/Breadcrumbs'
import { useBrand } from '@/hooks/useBrand'
import { useBrandProducts } from '@/hooks/useBrandProducts'
import { useBrandPosts } from '@/hooks/useBrandPosts'
import { useFollowBrand } from '@/hooks/useFollowBrand'
import { useBrandAmbassadorsPublic } from '@/hooks/useBrandAmbassadorsPublic'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import BrandProfileV2 from '@/components/profile/v2/BrandProfileV2'
import { useAuthStore } from '@/lib/auth'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackProfileView, trackPublicProfileViewed } from '@/lib/analytics'
import PublicProfileFooterCTA from '@/components/profile/PublicProfileFooterCTA'
import { usePublicProfileMeta } from '@/hooks/usePublicProfileMeta'

export default function BrandProfilePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const { user, profile } = useAuthStore()
  const { brand, isLoading, error } = useBrand(slug)
  const [isBlockedProfile, setIsBlockedProfile] = useState(false)
  const [blockChecked, setBlockChecked] = useState(false)
  const { products } = useBrandProducts(brand?.id)
  const { posts } = useBrandPosts(brand?.id)
  const { isFollowing, followerCount, toggleFollow, isToggling } = useFollowBrand(brand?.id)
  const { ambassadors, total: ambassadorTotal } = useBrandAmbassadorsPublic(brand?.id)

  // Block check — must complete before rendering profile.
  //
  // `blockChecked` OPENS the render gate, so a stale resolution unlocking it
  // is a fail-OPEN: navigating brand A → B fast could let A's .finally()
  // set blockChecked=true while B's own check was still in flight, briefly
  // rendering B before it had been cleared. Same P1 class the July audit
  // fixed on the player/coach/club profile pages.
  //
  // Guarded, and the result is now assigned rather than only ever set to
  // true — a sticky `true` from a previous brand hid an unrelated one.
  useEffect(() => {
    let cancelled = false
    setBlockChecked(false)
    setIsBlockedProfile(false)
    if (!brand || !user) { setBlockChecked(true); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('is_blocked_pair', { p_user_a: user.id, p_user_b: brand.profile_id })
      .then(({ data }: { data: boolean }) => { if (!cancelled) setIsBlockedProfile(Boolean(data)) })
      .catch(() => { /* fail closed: leave isBlockedProfile false, gate opens below */ })
      .finally(() => { if (!cancelled) setBlockChecked(true) })
    return () => { cancelled = true }
  }, [brand?.profile_id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track brand profile view (skip if brand owner)
  const isOwnBrand = profile?.role === 'brand' && brand?.profile_id === user?.id
  useEffect(() => {
    if (!brand || isOwnBrand) return
    const ref = new URLSearchParams(window.location.search).get('ref') || 'direct'
    trackDbEvent('profile_view', 'profile', brand.profile_id, { viewed_role: 'brand', source: ref })
    void trackProfileView('brand', brand.profile_id)
    if (!user) trackPublicProfileViewed('brand')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id])

  usePublicProfileMeta({
    displayName: brand?.name ?? null,
    roleLabel: 'brand',
    description: brand?.bio ?? null,
    canonicalUrl: brand?.slug ? `https://inhockia.com/brands/${brand.slug}` : undefined,
  })

  // Phone: Profile v2 (Figma PR9) once the brand is loaded and cleared.
  if (brand && blockChecked && !isBlockedProfile) {
    const canAct = Boolean(user) && profile?.role !== 'brand' && !isOwnBrand
    return (
      <>
      {!isMobile && <Header />}
      <div className="lg:pt-24">
      <BrandProfileV2
        brand={brand}
        owner={false}
        products={products}
        posts={posts}
        ambassadors={ambassadors}
        ambassadorTotal={ambassadorTotal}
        followerCount={followerCount}
        isFollowing={isFollowing}
        followBusy={isToggling}
        onFollow={user ? toggleFollow : () => navigate('/signup')}
        canMessage={canAct}
        onMessage={() => navigate(`/messages?new=${brand.profile_id}`, { state: { messageOrigin: 'Profile' } })}
      />
      <PublicProfileFooterCTA />
      </div>
      </>
    )
  }

  return (
    <>
      {!isMobile && <Header />}

      <div className={`flex-1 bg-gray-50 ${isMobile ? 'pt-[var(--app-header-offset)]' : ''}`}>
        {/* Back Button (Mobile) */}
        {isMobile && (
          <div className="bg-white border-b border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
          </div>
        )}

        {/* Breadcrumbs (Desktop) */}
        {!isMobile && (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-2">
            <Breadcrumbs
              items={[
                { label: 'Marketplace', to: '/marketplace' },
                { label: brand?.name || 'Brand' },
              ]}
            />
          </div>
        )}

        {/* Loading State (includes block check) */}
        {(isLoading || !blockChecked) && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
              {error}
            </div>
          </div>
        )}

        {/* Blocked State */}
        {isBlockedProfile && (
          <div className="max-w-4xl mx-auto px-4 py-12 text-center">
            <Store className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">This profile is not available</h2>
            <button type="button" onClick={() => navigate(-1)} className="mt-4 text-hockia-primary hover:underline font-medium">Go back</button>
          </div>
        )}

        {/* Not Found State */}
        {!isLoading && !error && !brand && !isBlockedProfile && (
          <div className="max-w-4xl mx-auto px-4 py-12 text-center">
            <Store className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Brand not found
            </h2>
            <p className="text-gray-600 mb-6">
              The brand you're looking for doesn't exist or has been removed.
            </p>
            <Link to="/marketplace">
              <Button>Browse Marketplace</Button>
            </Link>
          </div>
        )}

        <PublicProfileFooterCTA />
      </div>
    </>
  )
}
