/**
 * BrandDashboard
 *
 * Dashboard page for brand users to manage their brand profile.
 * Follows the same structural pattern as PlayerDashboard, CoachDashboard, and ClubDashboard.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { Globe, Instagram, ExternalLink, Eye, Edit, Store, Package, Users, Plus, FileText, Loader2, Award, X } from 'lucide-react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import Header from '@/components/Header'
import { Avatar, Button, DashboardMenu, ProfileStrengthCard, RoleBadge, ScrollableTabs } from '@/components'
import { BrandForm, type BrandFormData, ProductCard, AddProductModal, BrandPostCard, AddPostModal, AddAmbassadorModal } from '@/components/brands'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import ConfirmActionModal from '@/components/ConfirmActionModal'
import { useBrandProfileStrength } from '@/hooks/useBrandProfileStrength'
import { useBrandProducts } from '@/hooks/useBrandProducts'
import type { BrandProduct, CreateProductInput, UpdateProductInput } from '@/hooks/useBrandProducts'
import { useBrandPosts } from '@/hooks/useBrandPosts'
import type { BrandPost, CreatePostInput, UpdatePostInput } from '@/hooks/useBrandPosts'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useBrandAnalytics } from '@/hooks/useBrandAnalytics'
import { useBrandAmbassadors } from '@/hooks/useBrandAmbassadors'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { getTimeAgo } from '@/lib/utils'
import Skeleton from '@/components/Skeleton'

type TabType = 'overview' | 'products' | 'posts' | 'ambassadors' | 'followers'

const TABS: { id: TabType; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Products' },
  { id: 'posts', label: 'Posts' },
  { id: 'ambassadors', label: 'Ambassadors' },
  { id: 'followers', label: 'Followers' },
]

export default function BrandDashboard() {
  const navigate = useNavigate()
  const { user, profile } = useAuthStore()
  const { brand, isLoading: brandLoading, updateBrand, refetch: refetchBrand } = useMyBrand()
  const { addToast } = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const param = searchParams.get('tab') as TabType | null
    return param && TABS.some(t => t.id === param) ? param : 'overview'
  })
  const [showEditModal, setShowEditModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Products
  const { products, isLoading: productsLoading, createProduct, updateProduct, deleteProduct } = useBrandProducts(brand?.id)
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<BrandProduct | null>(null)
  const [productToDelete, setProductToDelete] = useState<BrandProduct | null>(null)
  const [isDeletingProduct, setIsDeletingProduct] = useState(false)

  // Posts
  const { posts, isLoading: postsLoading, createPost, updatePost, deletePost: deletePostFn } = useBrandPosts(brand?.id)
  const [showAddPostModal, setShowAddPostModal] = useState(false)
  const [editingPost, setEditingPost] = useState<BrandPost | null>(null)
  const [postToDelete, setPostToDelete] = useState<BrandPost | null>(null)
  const [isDeletingPost, setIsDeletingPost] = useState(false)

  // Analytics
  const { analytics, isLoading: analyticsLoading } = useBrandAnalytics(30)

  // Ambassadors
  const {
    ambassadors,
    total: ambassadorsTotal,
    isLoading: ambassadorsLoading,
    addAmbassador,
    removeAmbassador,
    loadMore: loadMoreAmbassadors,
    hasMore: hasMoreAmbassadors,
  } = useBrandAmbassadors(brand?.id)
  const [showAddAmbassadorModal, setShowAddAmbassadorModal] = useState(false)
  const [ambassadorToRemove, setAmbassadorToRemove] = useState<{ player_id: string; full_name: string | null; status: string } | null>(null)
  const [isRemovingAmbassador, setIsRemovingAmbassador] = useState(false)

  // Derived: split ambassadors by status
  const pendingAmbassadors = ambassadors.filter(a => a.status === 'pending')
  const acceptedAmbassadors = ambassadors.filter(a => a.status === 'accepted')

  // Followers
  interface FollowerItem {
    profile_id: string
    full_name: string | null
    avatar_url: string | null
    role: string
    followed_at: string
  }
  const [followers, setFollowers] = useState<FollowerItem[]>([])
  const [followersTotal, setFollowersTotal] = useState(0)
  const [followersLoading, setFollowersLoading] = useState(false)
  const [followersOffset, setFollowersOffset] = useState(0)
  const FOLLOWERS_PAGE = 20

  const fetchFollowers = useCallback(async (offset: number, append: boolean) => {
    if (!brand?.id) return
    setFollowersLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_brand_followers', {
        p_brand_id: brand.id,
        p_limit: FOLLOWERS_PAGE,
        p_offset: offset,
      })
      if (error) throw error
      const result = data as { followers: FollowerItem[]; total: number }
      setFollowers(prev => append ? [...prev, ...result.followers] : result.followers)
      setFollowersTotal(result.total)
    } catch (err) {
      logger.error('[BrandDashboard] fetchFollowers error:', err)
    } finally {
      setFollowersLoading(false)
    }
  }, [brand?.id])

  // Fetch followers when tab is active
  useEffect(() => {
    if (activeTab === 'followers' && brand?.id) {
      setFollowersOffset(0)
      fetchFollowers(0, false)
    }
  }, [activeTab, brand?.id, fetchFollowers])

  const loadMoreFollowers = useCallback(() => {
    const nextOffset = followersOffset + FOLLOWERS_PAGE
    setFollowersOffset(nextOffset)
    fetchFollowers(nextOffset, true)
  }, [followersOffset, fetchFollowers])

  // Profile strength for brand
  const { percentage, buckets, loading: strengthLoading, refresh: refreshStrength } = useBrandProfileStrength({
    brand,
    productCount: products.length,
    ambassadorCount: acceptedAmbassadors.length,
  })

  // Snapshot ref for action-triggered strength toasts: set to current percentage
  // BEFORE a user action that may change strength, then compared after refresh.
  const strengthSnapshotRef = useRef<number | null>(null)

  // Redirect if not a brand user
  useEffect(() => {
    if (!user) {
      navigate('/signup', { replace: true })
      return
    }
    if (profile && profile.role !== 'brand') {
      navigate('/dashboard/profile', { replace: true })
    }
  }, [user, profile, navigate])

  // Redirect to onboarding if no brand exists
  useEffect(() => {
    if (!brandLoading && !brand && profile?.role === 'brand') {
      navigate('/brands/onboarding', { replace: true })
    }
  }, [brand, brandLoading, profile?.role, navigate])

  // Sync tab with URL
  useEffect(() => {
    const tabParam = searchParams.get('tab') as TabType | null
    if (tabParam && TABS.some(t => t.id === tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [searchParams, activeTab])

  // Refresh profile strength when switching to overview tab
  useEffect(() => {
    if (activeTab === 'overview') {
      void refreshStrength()
    }
  }, [activeTab, refreshStrength])

  // Show toast when profile strength improves after a user action.
  // Only fires when strengthSnapshotRef was set before a refresh (i.e. after
  // editing the brand, adding/removing a product). Passive navigation and
  // multi-phase initial loading never trigger the toast.
  useEffect(() => {
    if (strengthLoading) return
    if (strengthSnapshotRef.current === null) return

    const before = strengthSnapshotRef.current
    strengthSnapshotRef.current = null

    if (percentage > before) {
      const increase = percentage - before
      if (percentage >= 100) {
        addToast("Your brand profile is now complete!", 'success')
      } else {
        addToast(`Profile strength +${increase}%. Keep going!`, 'success')
      }
    }
  }, [percentage, strengthLoading, addToast])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const handleProductSubmit = async (data: CreateProductInput | UpdateProductInput, isEdit: boolean) => {
    if (isEdit && editingProduct) {
      const result = await updateProduct(editingProduct.id, data)
      if (result.success) {
        addToast('Product updated', 'success')
        setEditingProduct(null)
        strengthSnapshotRef.current = percentage
        await refreshStrength()
      }
      return result
    }
    const result = await createProduct(data as CreateProductInput)
    if (result.success) {
      addToast('Product added', 'success')
      strengthSnapshotRef.current = percentage
      await refreshStrength()
    }
    return result
  }

  const handleDeleteProduct = async () => {
    if (!productToDelete) return
    setIsDeletingProduct(true)
    try {
      const result = await deleteProduct(productToDelete.id)
      if (!result.success) throw new Error(result.error)
      addToast('Product deleted', 'success')
      setProductToDelete(null)
      strengthSnapshotRef.current = percentage
      await refreshStrength()
    } catch {
      addToast('Failed to delete product', 'error')
    } finally {
      setIsDeletingProduct(false)
    }
  }

  const handlePostSubmit = async (data: CreatePostInput | UpdatePostInput, isEdit: boolean) => {
    if (isEdit && editingPost) {
      const result = await updatePost(editingPost.id, data)
      if (result.success) {
        addToast('Post updated', 'success')
        setEditingPost(null)
      }
      return result
    }
    const result = await createPost(data as CreatePostInput)
    if (result.success) {
      addToast('Post published', 'success')
    }
    return result
  }

  const handleDeletePost = async () => {
    if (!postToDelete) return
    setIsDeletingPost(true)
    try {
      const result = await deletePostFn(postToDelete.id)
      if (!result.success) throw new Error(result.error)
      addToast('Post deleted', 'success')
      setPostToDelete(null)
    } catch {
      addToast('Failed to delete post', 'error')
    } finally {
      setIsDeletingPost(false)
    }
  }

  const handleAddAmbassador = async (playerId: string) => {
    const result = await addAmbassador(playerId)
    if (result.success) {
      addToast('Ambassador request sent', 'success')
      strengthSnapshotRef.current = percentage
      await refreshStrength()
    }
    return result
  }

  const handleRemoveAmbassador = async () => {
    if (!ambassadorToRemove) return
    setIsRemovingAmbassador(true)
    try {
      const result = await removeAmbassador(ambassadorToRemove.player_id)
      if (!result.success) throw new Error(result.error)
      addToast(
        ambassadorToRemove.status === 'pending' ? 'Ambassador request cancelled' : 'Ambassador removed',
        'success'
      )
      setAmbassadorToRemove(null)
      strengthSnapshotRef.current = percentage
      await refreshStrength()
    } catch {
      addToast(
        ambassadorToRemove.status === 'pending' ? 'Failed to cancel request' : 'Failed to remove ambassador',
        'error'
      )
    } finally {
      setIsRemovingAmbassador(false)
    }
  }

  const handleUpdateBrand = async (data: BrandFormData) => {
    setIsSubmitting(true)
    try {
      const result = await updateBrand({
        name: data.name,
        bio: data.bio || undefined,
        logo_url: data.logo_url || undefined,
        cover_url: data.cover_url || undefined,
        website_url: data.website_url || undefined,
        instagram_url: data.instagram_url || undefined,
        category: data.category,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to update brand')
      }

      addToast('Brand profile updated successfully', 'success')
      setShowEditModal(false)
      strengthSnapshotRef.current = percentage
      await refetchBrand()
      await refreshStrength()
    } catch (err) {
      logger.error('[BrandDashboard] Error updating brand:', err)
      addToast(err instanceof Error ? err.message : 'Failed to update brand', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getCategoryLabel = (category: string | null) => {
    if (!category) return null
    const labels: Record<string, string> = {
      equipment: 'Equipment',
      apparel: 'Apparel',
      accessories: 'Accessories',
      nutrition: 'Nutrition',
      services: 'Services',
      technology: 'Technology',
      other: 'Other',
    }
    return labels[category] || category
  }

  // Loading state
  if (brandLoading || !brand) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <Skeleton variant="circular" width={96} height={96} className="flex-shrink-0" />
              <div className="flex-1 space-y-4">
                <Skeleton width="60%" height={40} />
                <div className="flex flex-wrap gap-4">
                  <Skeleton width={160} height={24} />
                  <Skeleton width={140} height={24} />
                </div>
                <Skeleton width={90} height={28} className="rounded-full" />
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white shadow-sm">
            <div className="space-y-6 p-6 md:p-8">
              <Skeleton width="40%" height={28} />
              <Skeleton width="100%" height={120} />
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main data-testid="brand-dashboard" className="max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-12">
        {/* Profile Card */}
        <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm mb-6 animate-fade-in overflow-visible">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <Avatar
              src={brand.logo_url}
              initials={getInitials(brand.name)}
              size="xl"
              className="flex-shrink-0"
              alt={brand.name ?? undefined}
              enablePreview
              previewTitle={brand.name ?? undefined}
            />

            <div className="flex-1">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">{brand.name}</h1>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/brands/${brand.slug}`)}
                    className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
                  >
                    <Eye className="w-4 h-4 flex-shrink-0" />
                    <span className="hidden xs:inline">Public View</span>
                    <span className="xs:hidden">View</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowEditModal(true)}
                    className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
                  >
                    <Edit className="w-4 h-4 flex-shrink-0" />
                    <span className="hidden xs:inline">Edit Brand</span>
                    <span className="xs:hidden">Edit</span>
                  </Button>
                  <DashboardMenu />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-gray-600 mb-4">
                {brand.category && (
                  <div className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    <span>{getCategoryLabel(brand.category)}</span>
                  </div>
                )}
                {brand.website_url && (
                  <a
                    href={brand.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:text-indigo-600 transition-colors"
                  >
                    <Globe className="w-5 h-5" />
                    <span className="truncate max-w-[200px]">
                      {brand.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {brand.instagram_url && (
                  <a
                    href={brand.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:text-indigo-600 transition-colors"
                  >
                    <Instagram className="w-5 h-5" />
                    <span>Instagram</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <RoleBadge role="brand" />
                {brand.is_verified && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                    Verified
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm animate-slide-in-up">
          <div className="sticky top-[68px] z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
            <ScrollableTabs
              tabs={TABS}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              className="gap-8 px-6"
              activeClassName="border-[#924CEC] text-[#924CEC]"
              inactiveClassName="border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
            />
          </div>

          <div className="p-6 md:p-8">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-8 animate-fade-in">
                {/* Analytics Cards */}
                {!analyticsLoading && analytics && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-gray-500 mb-1">
                        <Eye className="w-4 h-4" />
                        <span className="text-xs font-medium">Profile Views</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.profile_views}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Last 30 days
                        {analytics.profile_views_previous > 0 && (
                          <span className={analytics.profile_views >= analytics.profile_views_previous ? 'text-emerald-600' : 'text-red-500'}>
                            {' '}({analytics.profile_views >= analytics.profile_views_previous ? '+' : ''}
                            {Math.round(((analytics.profile_views - analytics.profile_views_previous) / analytics.profile_views_previous) * 100)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-gray-500 mb-1">
                        <Users className="w-4 h-4" />
                        <span className="text-xs font-medium">Followers</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.follower_count}</p>
                      <p className="text-xs text-gray-500 mt-1">Total</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-gray-500 mb-1">
                        <Package className="w-4 h-4" />
                        <span className="text-xs font-medium">Products</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.product_count}</p>
                      <p className="text-xs text-gray-500 mt-1">Published</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-gray-500 mb-1">
                        <FileText className="w-4 h-4" />
                        <span className="text-xs font-medium">Posts</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.post_count}</p>
                      <p className="text-xs text-gray-500 mt-1">Published</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center gap-2 text-gray-500 mb-1">
                        <Award className="w-4 h-4" />
                        <span className="text-xs font-medium">Ambassadors</span>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{analytics.ambassador_count}</p>
                      <p className="text-xs text-gray-500 mt-1">Active</p>
                    </div>
                  </div>
                )}

                {/* Profile Strength Card */}
                <ProfileStrengthCard
                  percentage={percentage}
                  buckets={buckets}
                  loading={strengthLoading}
                  onBucketAction={(bucket) => {
                    if (bucket.actionId === 'edit-profile') {
                      setShowEditModal(true)
                    } else if (bucket.actionId === 'add-product') {
                      handleTabChange('products')
                      setEditingProduct(null)
                      setShowAddProductModal(true)
                    } else if (bucket.actionId === 'add-ambassador') {
                      handleTabChange('ambassadors')
                      setShowAddAmbassadorModal(true)
                    }
                  }}
                />

                {/* Brand Info Section */}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Brand Information</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
                      <p className="text-gray-900 font-medium">{brand.name}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <p className="text-gray-900">{getCategoryLabel(brand.category) || 'Not specified'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                      {brand.website_url ? (
                        <a
                          href={brand.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          {brand.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <p className="text-gray-500 italic">Not specified</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Instagram</label>
                      {brand.instagram_url ? (
                        <a
                          href={brand.instagram_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          {brand.instagram_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <p className="text-gray-500 italic">Not specified</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* About Section */}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">About</h2>
                  {brand.bio ? (
                    <p className="text-gray-700 whitespace-pre-wrap">{brand.bio}</p>
                  ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                      <p className="text-gray-500 mb-4">Add a description to tell people about your brand.</p>
                      <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)}>
                        Add Description
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Products Tab */}
            {activeTab === 'products' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Products & Services</h2>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { setEditingProduct(null); setShowAddProductModal(true) }}
                    className="gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Product
                  </Button>
                </div>

                {productsLoading ? (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
                        <Skeleton width="100%" height={200} />
                        <div className="p-4 space-y-2">
                          <Skeleton width="60%" height={20} />
                          <Skeleton width="100%" height={16} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : products.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No products yet</h3>
                    <p className="text-gray-600 max-w-md mx-auto mb-4">
                      Showcase your products and services here. Athletes will be able to discover and connect with your brand.
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => { setEditingProduct(null); setShowAddProductModal(true) }}
                      className="gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Your First Product
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {products.map(product => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        brandWebsiteUrl={brand.website_url}
                        isOwner
                        onEdit={(p) => { setEditingProduct(p); setShowAddProductModal(true) }}
                        onDelete={(p) => setProductToDelete(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Posts Tab */}
            {activeTab === 'posts' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Brand Announcements</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Appear on your brand profile and in the global feed</p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { setEditingPost(null); setShowAddPostModal(true) }}
                    className="gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Post
                  </Button>
                </div>

                {postsLoading ? (
                  <div className="space-y-4">
                    {[1, 2].map(i => (
                      <div key={i} className="rounded-xl border border-gray-200 p-4 space-y-3">
                        <Skeleton width="60%" height={18} />
                        <Skeleton width="100%" height={14} />
                        <Skeleton width="80%" height={14} />
                      </div>
                    ))}
                  </div>
                ) : posts.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No posts yet</h3>
                    <p className="text-gray-600 max-w-md mx-auto mb-4">
                      Share updates, announcements, and news with your audience. Posts appear in the global brand feed.
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => { setEditingPost(null); setShowAddPostModal(true) }}
                      className="gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Create Your First Post
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {posts.map(post => (
                      <BrandPostCard
                        key={post.id}
                        post={post}
                        brandName={brand.name}
                        brandSlug={brand.slug}
                        brandLogoUrl={brand.logo_url}
                        brandIsVerified={brand.is_verified}
                        isOwner
                        onEdit={(p) => { setEditingPost(p); setShowAddPostModal(true) }}
                        onDelete={(p) => setPostToDelete(p)}
                      />
                    ))}
                  </div>
                )}

                {/* Home Feed Posts */}
                {profile?.id && (
                  <div className="mt-8 pt-8 border-t border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Home Feed Posts</h3>
                    <ProfilePostsTab profileId={profile.id} />
                  </div>
                )}
              </div>
            )}

            {/* Ambassadors Tab */}
            {activeTab === 'ambassadors' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">Ambassadors</h2>
                    {ambassadorsTotal > 0 && (
                      <span className="text-sm text-gray-500 sm:hidden">{ambassadorsTotal} total</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {ambassadorsTotal > 0 && (
                      <span className="text-sm text-gray-500 hidden sm:inline">{ambassadorsTotal} total</span>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowAddAmbassadorModal(true)}
                      className="gap-2 w-full sm:w-auto"
                    >
                      <Plus className="w-4 h-4" />
                      Invite Ambassador
                    </Button>
                  </div>
                </div>

                {ambassadorsLoading && ambassadors.length === 0 ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                        <Skeleton width={40} height={40} className="rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton width="40%" height={16} />
                          <Skeleton width="25%" height={12} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : ambassadors.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <Award className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No ambassadors yet</h3>
                    <p className="text-gray-600 max-w-md mx-auto mb-4">
                      Invite the players you sponsor to become brand ambassadors. They'll appear on your public profile once they accept.
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowAddAmbassadorModal(true)}
                      className="gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Invite Your First Ambassador
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Pending Requests */}
                    {pendingAmbassadors.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                          Pending Requests ({pendingAmbassadors.length})
                        </h3>
                        <div className="space-y-3">
                          {pendingAmbassadors.map(ambassador => (
                            <div
                              key={ambassador.player_id}
                              className="flex items-center gap-3 bg-amber-50 rounded-xl border border-amber-200 p-4"
                            >
                              <Link
                                to={`/players/id/${ambassador.player_id}`}
                                className="flex items-center gap-3 flex-1 min-w-0"
                              >
                                <Avatar
                                  src={ambassador.avatar_url}
                                  initials={ambassador.full_name?.slice(0, 2) || '?'}
                                  size="sm"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-gray-900 truncate">
                                      {ambassador.full_name || 'Unknown'}
                                    </p>
                                    <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                      Pending
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 truncate">
                                    {[ambassador.position, ambassador.current_club]
                                      .filter(Boolean)
                                      .join(' \u00B7 ') || 'Player'}
                                  </p>
                                </div>
                              </Link>
                              <button
                                type="button"
                                onClick={() => setAmbassadorToRemove({
                                  player_id: ambassador.player_id,
                                  full_name: ambassador.full_name,
                                  status: ambassador.status,
                                })}
                                className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                aria-label="Cancel request"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Active Ambassadors */}
                    {acceptedAmbassadors.length > 0 && (
                      <div>
                        {pendingAmbassadors.length > 0 && (
                          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Active ({acceptedAmbassadors.length})
                          </h3>
                        )}
                        <div className="space-y-3">
                          {acceptedAmbassadors.map(ambassador => (
                            <div
                              key={ambassador.player_id}
                              className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                            >
                              <Link
                                to={`/players/id/${ambassador.player_id}`}
                                className="flex items-center gap-3 flex-1 min-w-0"
                              >
                                <Avatar
                                  src={ambassador.avatar_url}
                                  initials={ambassador.full_name?.slice(0, 2) || '?'}
                                  size="sm"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    {ambassador.full_name || 'Unknown'}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {[ambassador.position, ambassador.current_club]
                                      .filter(Boolean)
                                      .join(' \u00B7 ') || 'Player'}
                                  </p>
                                </div>
                                <span className="hidden sm:inline-flex"><RoleBadge role="player" /></span>
                              </Link>
                              <button
                                type="button"
                                onClick={() => setAmbassadorToRemove({
                                  player_id: ambassador.player_id,
                                  full_name: ambassador.full_name,
                                  status: ambassador.status,
                                })}
                                className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                aria-label="Remove ambassador"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Load more */}
                    {hasMoreAmbassadors && (
                      <div className="flex justify-center pt-2">
                        <button
                          type="button"
                          onClick={loadMoreAmbassadors}
                          disabled={ambassadorsLoading}
                          className="px-6 py-2 text-sm font-medium text-[#8026FA] bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          {ambassadorsLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Load more'
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Followers Tab */}
            {activeTab === 'followers' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Followers</h2>
                  {followersTotal > 0 && (
                    <span className="text-sm text-gray-500">{followersTotal} total</span>
                  )}
                </div>

                {followersLoading && followers.length === 0 ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                        <Skeleton width={40} height={40} className="rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton width="40%" height={16} />
                          <Skeleton width="25%" height={12} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : followers.length === 0 ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                    <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No followers yet</h3>
                    <p className="text-gray-600 max-w-md mx-auto">
                      Share your brand profile to grow your audience. Athletes and clubs can follow your brand from your profile page.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {followers.map(follower => (
                        <Link
                          key={follower.profile_id}
                          to={
                            follower.role === 'club'
                              ? `/clubs/id/${follower.profile_id}`
                              : follower.role === 'coach'
                                ? `/coaches/id/${follower.profile_id}`
                                : `/players/id/${follower.profile_id}`
                          }
                          className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                        >
                          <Avatar
                            src={follower.avatar_url}
                            initials={follower.full_name?.slice(0, 2) || '?'}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {follower.full_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-gray-500">
                              Followed {getTimeAgo(follower.followed_at, true)}
                            </p>
                          </div>
                          <RoleBadge role={follower.role} />
                        </Link>
                      ))}
                    </div>

                    {/* Load more */}
                    {followers.length < followersTotal && (
                      <div className="flex justify-center pt-2">
                        <button
                          type="button"
                          onClick={loadMoreFollowers}
                          disabled={followersLoading}
                          className="px-6 py-2 text-sm font-medium text-[#8026FA] bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          {followersLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Load more'
                          )}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Edit Brand Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowEditModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Edit Brand Profile</h2>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                <BrandForm
                  brand={brand}
                  onSubmit={handleUpdateBrand}
                  isSubmitting={isSubmitting}
                  submitLabel="Save Changes"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Product Modal */}
      {brand && (
        <AddProductModal
          isOpen={showAddProductModal}
          onClose={() => { setShowAddProductModal(false); setEditingProduct(null) }}
          onSubmit={handleProductSubmit}
          brandId={brand.id}
          editingProduct={editingProduct}
        />
      )}

      {/* Delete Product Confirmation */}
      {productToDelete && (
        <ConfirmActionModal
          isOpen={Boolean(productToDelete)}
          title="Delete Product"
          description={`Are you sure you want to delete "${productToDelete.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmTone="danger"
          onConfirm={handleDeleteProduct}
          onClose={() => setProductToDelete(null)}
          confirmLoading={isDeletingProduct}
        />
      )}

      {/* Add/Edit Post Modal */}
      {brand && (
        <AddPostModal
          isOpen={showAddPostModal}
          onClose={() => { setShowAddPostModal(false); setEditingPost(null) }}
          onSubmit={handlePostSubmit}
          brandId={brand.id}
          editingPost={editingPost}
        />
      )}

      {/* Delete Post Confirmation */}
      {postToDelete && (
        <ConfirmActionModal
          isOpen={Boolean(postToDelete)}
          title="Delete Post"
          description="Are you sure you want to delete this post? This action cannot be undone."
          confirmLabel="Delete"
          confirmTone="danger"
          onConfirm={handleDeletePost}
          onClose={() => setPostToDelete(null)}
          confirmLoading={isDeletingPost}
        />
      )}

      {/* Add Ambassador Modal */}
      {brand && (
        <AddAmbassadorModal
          isOpen={showAddAmbassadorModal}
          onClose={() => setShowAddAmbassadorModal(false)}
          onAdd={handleAddAmbassador}
          existingPlayerIds={ambassadors.map(a => a.player_id)}
        />
      )}

      {/* Remove Ambassador / Cancel Request Confirmation */}
      {ambassadorToRemove && (
        <ConfirmActionModal
          isOpen={Boolean(ambassadorToRemove)}
          title={ambassadorToRemove.status === 'pending' ? 'Cancel Request' : 'Remove Ambassador'}
          description={
            ambassadorToRemove.status === 'pending'
              ? `Cancel the ambassador request to ${ambassadorToRemove.full_name || 'this player'}?`
              : `Remove ${ambassadorToRemove.full_name || 'this player'} as a brand ambassador?`
          }
          confirmLabel={ambassadorToRemove.status === 'pending' ? 'Cancel Request' : 'Remove'}
          confirmTone="danger"
          onConfirm={handleRemoveAmbassador}
          onClose={() => setAmbassadorToRemove(null)}
          confirmLoading={isRemovingAmbassador}
        />
      )}
    </div>
  )
}
