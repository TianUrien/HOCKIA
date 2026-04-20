import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { BrandDetail } from './useBrand'

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
 * Buckets:
 * - Brand Identity (25%): name, logo_url, category
 * - About (20%): bio field filled (min 50 chars)
 * - Contact Info (15%): website_url OR instagram_url
 * - Location (10%): country in profile
 * - Products (20%): at least one product added
 * - Ambassadors (10%): at least one brand ambassador
 */
export function useBrandProfileStrength({ brand, productCount = 0, ambassadorCount = 0 }: UseBrandProfileStrengthOptions) {
  const [loading, setLoading] = useState(true)
  const [profileCountry, setProfileCountry] = useState<string | null>(null)

  const profileId = brand?.profile_id ?? null

  // Fetch profile country for the brand owner
  const fetchProfileData = useCallback(async () => {
    if (!profileId) {
      setProfileCountry(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('profiles')
        .select('nationality, nationality_country_id')
        .eq('id', profileId)
        .single()

      const countryValue = data?.nationality_country_id ?? data?.nationality ?? null
      setProfileCountry(countryValue != null ? String(countryValue) : null)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void fetchProfileData()
  }, [fetchProfileData])

  // Check brand identity (name, logo, category)
  const isBrandIdentityComplete = useCallback(() => {
    if (!brand) return false
    const hasName = Boolean(brand.name?.trim())
    const hasLogo = Boolean(brand.logo_url?.trim())
    const hasCategory = Boolean(brand.category?.trim())
    return hasName && hasLogo && hasCategory
  }, [brand])

  // Check about/bio (min 50 chars)
  const hasAbout = useCallback(() => {
    if (!brand) return false
    return Boolean(brand.bio?.trim() && brand.bio.trim().length >= 50)
  }, [brand])

  // Check contact info (website or instagram)
  const hasContactInfo = useCallback(() => {
    if (!brand) return false
    return Boolean(brand.website_url?.trim() || brand.instagram_url?.trim())
  }, [brand])

  // Check location
  const hasLocation = useCallback(() => {
    return Boolean(profileCountry)
  }, [profileCountry])

  // Check products
  const hasProducts = productCount > 0

  // Check ambassadors
  const hasAmbassadors = ambassadorCount > 0

  // Build buckets
  const buckets: ProfileStrengthBucket[] = useMemo(() => {
    const identityComplete = isBrandIdentityComplete()
    const aboutComplete = hasAbout()
    const contactComplete = hasContactInfo()
    const locationComplete = hasLocation()

    return [
      {
        id: 'identity',
        label: 'Brand Identity',
        hint: 'Add your brand name, logo, and category',
        unlockCopy: 'A clear name, logo, and category is the foundation for people finding you.',
        weight: 25,
        completed: identityComplete,
        actionId: 'edit-profile',
        actionLabel: 'Edit Brand',
      },
      {
        id: 'about',
        label: 'About Your Brand',
        hint: 'Write a description about your brand (min 50 characters)',
        unlockCopy: 'Tell players and clubs what makes your brand worth following.',
        weight: 20,
        completed: aboutComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Description',
      },
      {
        id: 'contact',
        label: 'Contact Info',
        hint: 'Add your website or Instagram link',
        unlockCopy: 'A direct way for people to reach you outside HOCKIA.',
        weight: 15,
        completed: contactComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Contact',
      },
      {
        id: 'location',
        label: 'Location',
        hint: 'Add your country in profile settings',
        unlockCopy: 'Players favour brands they can buy from locally or that ship to their region.',
        weight: 10,
        completed: locationComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Location',
      },
      {
        id: 'products',
        label: 'Products',
        hint: 'Add at least one product to showcase',
        unlockCopy: 'A brand page without products is just an About section — show what you make.',
        weight: 20,
        completed: hasProducts,
        actionId: 'add-product',
        actionLabel: 'Add Product',
      },
      {
        id: 'ambassadors',
        label: 'Ambassadors',
        hint: 'Add at least one brand ambassador',
        unlockCopy: 'Players associated with your brand bring their network with them.',
        weight: 10,
        completed: hasAmbassadors,
        actionId: 'add-ambassador',
        actionLabel: 'Add Ambassador',
      },
    ]
  }, [isBrandIdentityComplete, hasAbout, hasContactInfo, hasLocation, hasProducts, hasAmbassadors])

  // Calculate total percentage
  const percentage = useMemo(() => {
    return buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** True while fetching data */
    loading,
    /** Re-fetch data (call after updates) */
    refresh: fetchProfileData,
  }
}
