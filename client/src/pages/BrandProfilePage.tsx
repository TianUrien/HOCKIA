/**
 * BrandProfilePage
 *
 * Public profile page for a brand.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Store, MessageCircle, UserPlus, UserCheck, Award } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Header, Layout, Button, Avatar } from '@/components'
import { BrandHeader, ProductCard, BrandPostCard } from '@/components/brands'
import Breadcrumbs from '@/components/Breadcrumbs'
import { useBrand } from '@/hooks/useBrand'
import { useBrandProducts } from '@/hooks/useBrandProducts'
import { useBrandPosts } from '@/hooks/useBrandPosts'
import { useFollowBrand } from '@/hooks/useFollowBrand'
import { useBrandAmbassadorsPublic } from '@/hooks/useBrandAmbassadorsPublic'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAuthStore } from '@/lib/auth'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackProfileView } from '@/lib/analytics'
import Skeleton from '@/components/Skeleton'
import ProfileActionMenu from '@/components/ProfileActionMenu'

export default function BrandProfilePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const { user, profile } = useAuthStore()
  const { brand, isLoading, error } = useBrand(slug)
  const [isBlockedProfile, setIsBlockedProfile] = useState(false)
  const [blockChecked, setBlockChecked] = useState(false)
  const { products, isLoading: productsLoading } = useBrandProducts(brand?.id)
  const { posts, isLoading: postsLoading } = useBrandPosts(brand?.id)
  const { isFollowing, followerCount, toggleFollow, isToggling } = useFollowBrand(brand?.id)
  const { ambassadors, total: ambassadorTotal, isLoading: ambassadorsLoading } = useBrandAmbassadorsPublic(brand?.id)

  // Block check — must complete before rendering profile
  useEffect(() => {
    if (!brand) { setBlockChecked(true); return }
    if (!user) { setBlockChecked(true); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('is_blocked_pair', { p_user_a: user.id, p_user_b: brand.profile_id })
      .then(({ data }: { data: boolean }) => { if (data) setIsBlockedProfile(true) })
      .catch(() => {})
      .finally(() => setBlockChecked(true))
  }, [brand?.profile_id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track brand profile view (skip if brand owner)
  const isOwnBrand = profile?.role === 'brand' && brand?.profile_id === user?.id
  useEffect(() => {
    if (!brand || isOwnBrand) return
    const ref = new URLSearchParams(window.location.search).get('ref') || 'direct'
    trackDbEvent('profile_view', 'profile', brand.profile_id, { viewed_role: 'brand', source: ref })
    trackProfileView('brand', brand.profile_id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id])

  return (
    <Layout>
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
                { label: 'Brands', to: '/brands' },
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
            <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">This profile is not available</h2>
            <button type="button" onClick={() => navigate(-1)} className="mt-4 text-[#8026FA] hover:underline font-medium">Go back</button>
          </div>
        )}

        {/* Not Found State */}
        {!isLoading && !error && !brand && !isBlockedProfile && (
          <div className="max-w-4xl mx-auto px-4 py-12 text-center">
            <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Brand not found
            </h2>
            <p className="text-gray-600 mb-6">
              The brand you're looking for doesn't exist or has been removed.
            </p>
            <Link to="/brands">
              <Button>Browse Brands</Button>
            </Link>
          </div>
        )}

        {/* Brand Profile */}
        {brand && !isBlockedProfile && (
          <>
            {/* Header */}
            <BrandHeader brand={brand} />

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
              {/* Action Buttons */}
              {user && profile?.role !== 'brand' && (
                <div className="flex flex-wrap gap-3 mb-6">
                  {brand && (
                    <Link to={`/messages?new=${brand.profile_id}`}>
                      <Button className="gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Send Message
                      </Button>
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={toggleFollow}
                    disabled={isToggling}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isFollowing
                        ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600 border border-gray-200'
                        : 'bg-[#E11D48]/10 text-[#E11D48] hover:bg-[#E11D48]/20 border border-[#E11D48]/20'
                    }`}
                  >
                    {isFollowing ? (
                      <UserCheck className="w-4 h-4" />
                    ) : (
                      <UserPlus className="w-4 h-4" />
                    )}
                    {isFollowing ? 'Following' : 'Follow'}
                    {followerCount > 0 && (
                      <span className="text-xs opacity-70">{followerCount}</span>
                    )}
                  </button>
                  {brand && <ProfileActionMenu targetId={brand.profile_id} targetName={brand.name ?? 'this brand'} />}
                </div>
              )}

              {/* About Section */}
              {brand.bio && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">
                    About
                  </h2>
                  <p className="text-gray-600 whitespace-pre-wrap">
                    {brand.bio}
                  </p>
                </div>
              )}

              {/* Brand Ambassadors */}
              {!ambassadorsLoading && ambassadors.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Award className="w-5 h-5 text-[#E11D48]" />
                      <h2 className="text-lg font-semibold text-gray-900">
                        Brand Ambassadors
                      </h2>
                    </div>
                    {ambassadorTotal > 0 && (
                      <span className="text-sm text-gray-500">{ambassadorTotal}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {ambassadors.map(ambassador => (
                      <Link
                        key={ambassador.player_id}
                        to={`/players/id/${ambassador.player_id}`}
                        className="flex flex-col items-center text-center p-3 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <Avatar
                          src={ambassador.avatar_url}
                          initials={ambassador.full_name?.slice(0, 2) || '?'}
                          size="lg"
                        />
                        <p className="text-sm font-semibold text-gray-900 mt-2 truncate w-full">
                          {ambassador.full_name || 'Unknown'}
                        </p>
                        {ambassador.position && (
                          <p className="text-xs text-gray-500 truncate w-full">
                            {ambassador.position.charAt(0).toUpperCase() + ambassador.position.slice(1)}
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Latest Updates (brand posts) */}
              {!postsLoading && posts.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Latest Updates
                  </h2>
                  <div className="space-y-4">
                    {posts.slice(0, 3).map(post => (
                      <BrandPostCard
                        key={post.id}
                        post={post}
                        brandName={brand.name}
                        brandSlug={brand.slug}
                        brandLogoUrl={brand.logo_url}
                        brandIsVerified={brand.is_verified}
                      />
                    ))}
                  </div>
                  {posts.length > 3 && (
                    <div className="mt-4 text-center">
                      <Link
                        to={`/brands?view=feed`}
                        className="text-sm font-medium text-[#8026FA] hover:text-[#6b1fd4]"
                      >
                        View all updates
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* Products & Services */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Products & Services
                </h2>

                {productsLoading ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[1, 2].map(i => (
                      <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
                        <Skeleton width="100%" height={180} />
                        <div className="p-4 space-y-2">
                          <Skeleton width="60%" height={20} />
                          <Skeleton width="100%" height={16} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : products.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    This brand hasn't added any products yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {products.map(product => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        brandWebsiteUrl={brand.website_url}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
