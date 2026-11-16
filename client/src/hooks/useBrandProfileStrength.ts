import { useMemo } from 'react'
import type { BrandDetail } from './useBrand'
import { useBrandsT } from '@/i18n/ns/brands'

export interface ProfileStrengthBucket {
  id: string
  label: string
  /** Description shown when incomplete */
  hint: string
  /** Honest, conservative line describing what completing this step unlocks for the user */
  unlockCopy: string
  /** Weight out of 100 */
  weight: number
  /** True when this bucket is fully completed */
  completed: boolean
  /** Optional action id the parent can handle (e.g. "edit-profile") */
  actionId?: string
  /** Label for the CTA button */
  actionLabel?: string
}

interface UseBrandProfileStrengthOptions {
  brand: BrandDetail | null
  /** Number of products the brand has (passed from parent to avoid duplicate fetches) */
  productCount?: number
  /** Number of ambassadors the brand has (passed from parent to avoid duplicate fetches) */
  ambassadorCount?: number
}

/**
 * Brand-specific profile strength calculation.
 *
 * 2d-bis: buckets mirror the canonical SQL formula (brand branch, which reads
 * the brands table) EXACTLY so the owner's dashboard % equals the public
 * Community-card %. Five buckets summing to 100:
 *   logo 20 · about (bio) 20 · website/Instagram 20 · country 20 · ambassadors 20
 *
 * All inputs are on the `brand` prop (the brands row) + the ambassador count —
 * no extra query, so no async loading. (The old formula also scored brand name,
 * category, and products; the canonical formula doesn't — product_count isn't a
 * brands column — so those are dropped to keep one number everywhere.)
 */
export function useBrandProfileStrength({ brand, ambassadorCount = 0 }: UseBrandProfileStrengthOptions) {
  const t = useBrandsT()
  const buckets: ProfileStrengthBucket[] = useMemo(() => {
    const hasLogo = Boolean(brand?.logo_url?.trim())
    // Canonical scores bio when non-empty (NOT the old >=50-char gate).
    const hasBio = Boolean(brand?.bio?.trim())
    const hasContact = Boolean(brand?.website_url?.trim() || brand?.instagram_url?.trim())
    // Canonical uses the BRAND's own country_id (brands table), not the owner's.
    const hasCountry = Boolean(brand?.country_id)
    const hasAmbassadors = ambassadorCount > 0

    return [
      {
        id: 'logo',
        label: t('strength.logoLabel'),
        hint: t('strength.logoHint'),
        unlockCopy: t('strength.logoUnlock'),
        weight: 20,
        completed: hasLogo,
        actionId: 'edit-profile',
        actionLabel: t('strength.logoAction'),
      },
      {
        id: 'about',
        label: t('strength.aboutLabel'),
        hint: t('strength.aboutHint'),
        unlockCopy: t('strength.aboutUnlock'),
        weight: 20,
        completed: hasBio,
        actionId: 'edit-profile',
        actionLabel: t('strength.aboutAction'),
      },
      {
        id: 'contact',
        label: t('strength.contactLabel'),
        hint: t('strength.contactHint'),
        unlockCopy: t('strength.contactUnlock'),
        weight: 20,
        completed: hasContact,
        actionId: 'edit-profile',
        actionLabel: t('strength.contactAction'),
      },
      {
        id: 'country',
        label: t('strength.countryLabel'),
        hint: t('strength.countryHint'),
        unlockCopy: t('strength.countryUnlock'),
        weight: 20,
        completed: hasCountry,
        actionId: 'edit-profile',
        actionLabel: t('strength.countryAction'),
      },
      {
        id: 'ambassadors',
        label: t('strength.ambassadorsLabel'),
        hint: t('strength.ambassadorsHint'),
        unlockCopy: t('strength.ambassadorsUnlock'),
        weight: 20,
        completed: hasAmbassadors,
        actionId: 'add-ambassador',
        actionLabel: t('strength.ambassadorsAction'),
      },
    ]
  }, [brand, ambassadorCount, t])

  // Calculate total percentage (canonical buckets sum to 100).
  const percentage = useMemo(() => {
    return buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** No async work — strength derives from the `brand` prop. */
    loading: false,
    /** No-op: the % derives from the `brand` prop; refetch the brand upstream. */
    refresh: async () => {},
  }
}
