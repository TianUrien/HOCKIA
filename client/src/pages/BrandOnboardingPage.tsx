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
import { logger } from '@/lib/logger'
import { toSentryError } from '@/lib/sentryHelpers'
import { supabase } from '@/lib/supabase'

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

  // Loop-safe brand-exists handling. Three legacy/edge cases this guards
  // against, all of which previously trapped the user:
  //
  //   (a) brand row exists + onboarding_completed=true (happy returning
  //       user): just send them to /dashboard/profile so DashboardRouter
  //       picks up the canonical role-based dashboard.
  //
  //   (b) brand row exists + onboarding_completed=false (legacy half-state
  //       from before atomic onboarding migration 202604180200, OR an
  //       admin-edited row): heal the state by setting the flag to true
  //       (the brand row is the source of truth for "did the user finish
  //       brand onboarding"), then send them to the dashboard. Without
  //       this, the user would bounce between /dashboard/profile (sees
  //       !onboarding_completed → /complete-profile → sees role=brand →
  //       /brands/onboarding → sees brand exists → /brands/:slug … no way
  //       to re-finish).
  //
  //   (c) ref guard so we don't hammer the heal-update on every re-render.
  //
  //   (d) heal-failure path: the prior implementation logged the error and
  //       fell through to navigate('/dashboard/profile'). DashboardRouter
  //       sees onboarding_completed=false and bounces back to
  //       /complete-profile → /brands/onboarding → re-mount → reset ref →
  //       try again — an infinite bounce loop on persistent RLS / network
  //       failure. Now we surface a real error UI so the user can retry
  //       manually instead of being silently stuck.
  // healAttempt is bumped to force the heal effect to re-fire on retry.
  // Using a counter (not a boolean) so each retry is a distinct dep change
  // that React's effect-dep equality picks up. setHealError(null) alone
  // does NOT re-fire the effect — healError isn't in the dep array, and
  // none of the existing deps (brand/profile/user) change on retry.
  const [healAttempt, setHealAttempt] = useState(0)
  const [healError, setHealError] = useState<string | null>(null)
  useEffect(() => {
    if (brandLoading || !brand || !user) return
    if (profile?.onboarding_completed) {
      navigate('/dashboard/profile', { replace: true })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { error: healErr } = await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
        if (cancelled) return
        if (healErr) {
          logger.error('[BrandOnboarding] Failed to heal half-state', healErr)
          Sentry.captureException(toSentryError(healErr), {
            tags: { feature: 'brand_onboarding', operation: 'heal_half_state' },
          })
          setHealError(
            'Something went wrong restoring your brand onboarding. Please try again or contact support.',
          )
          return
        }
        await fetchProfile(user.id, { force: true })
        if (cancelled) return
        navigate('/dashboard/profile', { replace: true })
      } catch (err) {
        if (cancelled) return
        logger.error('[BrandOnboarding] Heal threw unexpected error', err)
        Sentry.captureException(toSentryError(err), {
          tags: { feature: 'brand_onboarding', operation: 'heal_half_state' },
        })
        setHealError(
          'Something went wrong restoring your brand onboarding. Please try again or contact support.',
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brand, brandLoading, navigate, profile?.onboarding_completed, user, fetchProfile, healAttempt])

  const retryHeal = () => {
    setHealError(null)
    // Bump the attempt counter — this IS in the effect's dep array,
    // so the effect re-fires synchronously on the next render and
    // re-runs the heal logic.
    setHealAttempt((n) => n + 1)
  }

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
      data: { userId: user?.id ?? null, category: data.category, country_id: data.country_id, hasLogo: !!data.logo_url },
    })

    // country_id is required by both the form (validated on submit) and the
    // create_brand RPC (rejects null). This guard keeps TypeScript happy
    // since data.country_id is nullable in BrandFormData; the form layer
    // already prevents reaching here with null, but defense-in-depth.
    if (data.country_id === null) {
      setError('Please choose a country for your brand.')
      return
    }

    try {
      const result = await createBrand({
        name: data.name,
        slug: data.slug,
        category: data.category,
        country_id: data.country_id,
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

      // create_brand RPC now sets onboarding_completed = true AND syncs
      // brand identity (full_name, avatar_url) to the profile in the same
      // transaction (migration 20260501120000). The post-RPC profiles.update
      // that lived here previously was redundant and re-introduced split-
      // brain risk — removed. We still refresh the profile cache so the
      // app picks up the new flag immediately.
      if (user) {
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

  // Heal-failure recovery UI. Replaces the previous "log + bounce to
  // dashboard" path which would loop infinitely against persistent RLS
  // / network errors. User can retry manually here.
  if (healError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-600 mb-4">{healError}</p>
          <button
            type="button"
            onClick={retryHeal}
            className="w-full px-4 py-2 bg-[#8026FA] text-white font-semibold rounded-lg hover:bg-[#6b1fd4] transition-colors"
          >
            Try again
          </button>
          <p className="text-xs text-gray-500 mt-3">
            If this keeps happening, contact support.
          </p>
        </div>
      </div>
    )
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
