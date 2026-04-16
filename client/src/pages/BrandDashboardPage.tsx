/**
 * BrandDashboardPage
 *
 * Dashboard page for brand owners to manage their brand profile.
 */

import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { Header, Layout } from '@/components'
import { BrandForm, type BrandFormData } from '@/components/brands'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useAuthStore } from '@/lib/auth'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

export default function BrandDashboardPage() {
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const { user, profile, loading: authLoading } = useAuthStore()
  const { brand, isLoading: brandLoading, updateBrand } = useMyBrand()
  const { addToast } = useToastStore()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Redirect if not authenticated or not a brand role
  useEffect(() => {
    if (authLoading) return

    if (!user) {
      navigate('/signup', { replace: true })
      return
    }

    if (profile?.role !== 'brand') {
      navigate('/dashboard/profile', { replace: true })
    }
  }, [user, profile, authLoading, navigate])

  // If no brand exists yet, redirect to onboarding
  useEffect(() => {
    if (!brandLoading && !brand && profile?.role === 'brand') {
      navigate('/brands/onboarding', { replace: true })
    }
  }, [brand, brandLoading, profile?.role, navigate])

  const handleSubmit = async (data: BrandFormData) => {
    setIsSubmitting(true)

    try {
      const result = await updateBrand({
        name: data.name,
        bio: data.bio || undefined,
        logo_url: data.logo_url || undefined,
        website_url: data.website_url || undefined,
        instagram_url: data.instagram_url || undefined,
        category: data.category,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to update brand')
      }

      addToast('Brand profile updated successfully', 'success')
    } catch (err) {
      logger.error('[BrandDashboardPage] Error updating brand:', err)
      addToast(err instanceof Error ? err.message : 'Failed to update brand', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (authLoading || brandLoading) {
    return (
      <Layout>
        {!isMobile && <Header />}
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      {!isMobile && <Header />}

      <div className={`flex-1 bg-gray-50 ${isMobile ? 'pt-[var(--app-header-offset)]' : ''}`}>
        {/* Back Navigation */}
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <Link
              to={brand ? `/brands/${brand.slug}` : '/brands'}
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Profile</span>
            </Link>

            {brand && (
              <Link
                to={`/brands/${brand.slug}`}
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
              >
                <span>View public profile</span>
                <ExternalLink className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Edit Brand Profile
          </h1>
          <p className="text-gray-600 mb-6">
            Update your brand information and settings.
          </p>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            {brand && (
              <BrandForm
                brand={brand}
                onSubmit={handleSubmit}
                isSubmitting={isSubmitting}
                submitLabel="Save Changes"
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
