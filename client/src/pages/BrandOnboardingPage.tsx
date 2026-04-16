/**
 * BrandOnboardingPage
 *
 * Onboarding flow for new brand users to create their brand profile.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { BrandForm, type BrandFormData } from '@/components/brands'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { toSentryError } from '@/lib/sentryHelpers'

export default function BrandOnboardingPage() {
  const navigate = useNavigate()
  const { user, profile, loading: authLoading, fetchProfile } = useAuthStore()
  const { brand, isLoading: brandLoading, createBrand } = useMyBrand()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Redirect if not authenticated or not a brand role
  useEffect(() => {
    if (authLoading) return

    if (!user) {
      navigate('/signup', { replace: true })
      return
    }

    if (profile?.role !== 'brand') {
      // Not a brand user, redirect to appropriate page
      if (profile?.onboarding_completed) {
        navigate('/dashboard/profile', { replace: true })
      } else {
        navigate('/complete-profile', { replace: true })
      }
    }
  }, [user, profile, authLoading, navigate])

  // If brand already exists, redirect to brand page
  useEffect(() => {
    if (!brandLoading && brand) {
      navigate(`/brands/${brand.slug}`, { replace: true })
    }
  }, [brand, brandLoading, navigate])

  const handleSubmit = async (data: BrandFormData) => {
    setIsSubmitting(true)
    setError(null)

    const tags = {
      feature: 'onboarding_profile',
      onboarding_role: 'brand' as const,
    }

    Sentry.addBreadcrumb({
      category: 'onboarding',
      level: 'info',
      message: 'brand_onboarding.submit',
      data: { userId: user?.id ?? null, category: data.category, hasLogo: !!data.logo_url },
    })

    try {
      const result = await createBrand({
        name: data.name,
        slug: data.slug,
        category: data.category,
        bio: data.bio || undefined,
        logo_url: data.logo_url || undefined,
        website_url: data.website_url || undefined,
        instagram_url: data.instagram_url || undefined,
      })

      if (!result.success) {
        const brandErr = new Error(result.error || 'Failed to create brand')
        Sentry.captureException(toSentryError(brandErr), {
          tags: { ...tags, onboarding_stage: 'create_brand' },
          extra: { userId: user?.id ?? null, slug: data.slug, category: data.category },
        })
        throw brandErr
      }

      Sentry.addBreadcrumb({
        category: 'onboarding',
        level: 'info',
        message: 'brand_onboarding.brand_created',
        data: { slug: result.slug },
      })

      // Mark onboarding as complete
      if (user) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)

        if (updateError) {
          Sentry.captureException(toSentryError(updateError), {
            tags: { ...tags, onboarding_stage: 'mark_onboarding_completed' },
            extra: { userId: user.id },
          })
          throw updateError
        }

        // Refresh profile
        await fetchProfile(user.id, { force: true })
      }

      Sentry.addBreadcrumb({
        category: 'onboarding',
        level: 'info',
        message: 'brand_onboarding.completed',
        data: { slug: result.slug },
      })

      // Navigate to the brand profile
      navigate(`/brands/${result.slug}`, { replace: true })
    } catch (err) {
      logger.error('[BrandOnboardingPage] Error creating brand:', err)
      setError(err instanceof Error ? err.message : 'Failed to create brand')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Loading state
  if (authLoading || brandLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="/hero-desktop.webp"
          alt="Field Hockey"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/70" />
      </div>

      {/* Form Card */}
      <div className="relative z-10 w-full max-w-xl">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-[#8026FA] to-[#924CEC]">
            <div className="flex items-center gap-3 mb-2">
              <img
                src="/WhiteLogo.svg"
                alt="HOCKIA"
                className="h-8"
              />
            </div>
            <p className="text-white/90 text-sm">
              Set up your brand profile
            </p>
          </div>

          {/* Form */}
          <div className="p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Create Your Brand
            </h2>
            <p className="text-gray-600 mb-6">
              Tell us about your brand to start connecting with athletes.
            </p>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <BrandForm
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitLabel="Create Brand"
              persistKey="onboarding"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
