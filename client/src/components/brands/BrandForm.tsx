/**
 * BrandForm Component
 *
 * Form for creating and editing brand profiles.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Input, Button } from '@/components'
import CountrySelect from '@/components/CountrySelect'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { logger } from '@/lib/logger'
import type { BrandCategory } from '@/hooks/useBrands'
import type { BrandDetail } from '@/hooks/useBrand'

interface BrandFormProps {
  brand?: BrandDetail | null
  onSubmit: (data: BrandFormData) => Promise<void>
  isSubmitting?: boolean
  submitLabel?: string
  /** Key for persisting draft to localStorage (enables draft saving when set) */
  persistKey?: string
}

export interface BrandFormData {
  name: string
  slug: string
  // Empty string = placeholder ("Choose a category…") still shown.
  // Required at submit time (validation below); we no longer auto-default
  // to 'equipment' which silently mis-categorised brands that didn't notice
  // the dropdown.
  category: BrandCategory | ''
  // null = no country selected (placeholder shown). Required at submit
  // (server-side rejects null in create_brand). Migration 20260525120000
  // added the column + backfilled existing brands; this collects it
  // going forward so 100% of new brands are discoverable by country.
  country_id: number | null
  bio: string
  logo_url: string
  website_url: string
  instagram_url: string
}

const CATEGORY_OPTIONS: { value: BrandCategory; label: string }[] = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'technology', label: 'Technology' },
  { value: 'coaching', label: 'Coaching & Training' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'media', label: 'Media' },
  { value: 'services', label: 'Services' },
  { value: 'other', label: 'Other' },
]

// Mirrors the server-side reserved slug list in
// 202604180500_brand_sync_trigger_hardening.sql so users get instant feedback
// instead of a round-trip "Invalid slug format" error from the RPC.
const RESERVED_SLUGS = new Set([
  'onboarding', 'new', 'edit', 'admin', 'settings', 'api',
  'null', 'undefined', 'brand', 'brands',
])

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Validate a website / social URL. Returns an error string, or null if OK.
 * Empty input is OK (the field is optional).
 *
 * Uses the WHATWG URL constructor for parsing — that catches malformed
 * structures like "not a url" → after the auto-https-prefix becomes
 * "https://not a url" which DOES parse (the URL spec is permissive about
 * hostnames) but fails the secondary checks (no dot, no path, contains
 * whitespace). Belt + braces.
 */
function validateBrandUrl(rawValue: string): string | null {
  const value = rawValue.trim()
  if (!value) return null // optional field
  // Prefix-aware: the onBlur handler already adds https:// if missing,
  // but on submit we may still see raw input. Try both shapes.
  const candidate = value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return 'That doesn\'t look like a valid URL.'
  }
  // Reject obvious garbage. Real domains have at least one dot AND don't
  // contain whitespace in the host.
  const host = parsed.hostname
  if (!host || host.includes(' ') || !host.includes('.')) {
    return 'That doesn\'t look like a valid URL.'
  }
  if (/\s/.test(parsed.pathname)) {
    return 'URLs cannot contain spaces.'
  }
  return null
}

const STORAGE_PREFIX = 'hockia_brand_draft_'
const LEGACY_STORAGE_PREFIX = 'playr_brand_draft_'

function migrateLegacyBrandDraft(persistKey: string): void {
  try {
    const newKey = STORAGE_PREFIX + persistKey
    const legacyKey = LEGACY_STORAGE_PREFIX + persistKey
    const legacy = localStorage.getItem(legacyKey)
    if (legacy && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, legacy)
    }
    if (legacy) {
      localStorage.removeItem(legacyKey)
    }
  } catch {
    // Ignore
  }
}

export function BrandForm({
  brand,
  onSubmit,
  isSubmitting = false,
  submitLabel = 'Save',
  persistKey,
}: BrandFormProps) {
  const { user } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load initial data from localStorage draft or brand prop
  const getInitialFormData = (): BrandFormData => {
    if (persistKey) {
      migrateLegacyBrandDraft(persistKey)
      try {
        const saved = localStorage.getItem(STORAGE_PREFIX + persistKey)
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<BrandFormData>
          return {
            name: parsed.name || brand?.name || '',
            slug: parsed.slug || brand?.slug || '',
            category: parsed.category || brand?.category || '',
            country_id: parsed.country_id ?? brand?.country_id ?? null,
            bio: parsed.bio || brand?.bio || '',
            logo_url: parsed.logo_url || brand?.logo_url || '',
            website_url: parsed.website_url || brand?.website_url || '',
            instagram_url: parsed.instagram_url || brand?.instagram_url || '',
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    return {
      name: brand?.name || '',
      slug: brand?.slug || '',
      category: brand?.category || '',
      country_id: brand?.country_id ?? null,
      bio: brand?.bio || '',
      logo_url: brand?.logo_url || '',
      website_url: brand?.website_url || '',
      instagram_url: brand?.instagram_url || '',
    }
  }

  const [formData, setFormData] = useState<BrandFormData>(getInitialFormData)
  // Slug-availability check: 'idle' before user starts typing, 'checking'
  // during the debounced RPC call, 'available' / 'taken' / 'invalid' once
  // settled. Surface state inline below the slug input so collisions don't
  // explode at submit. Skip entirely for existing brands (slug is locked).
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  // Inline URL validation errors. Surfaces below each field on blur so a
  // user typing "not a url" sees feedback before submit instead of a
  // permanently-broken link on their public brand page.
  const [websiteError, setWebsiteError] = useState<string | null>(null)
  const [instagramError, setInstagramError] = useState<string | null>(null)

  // Persist form data to localStorage when it changes
  useEffect(() => {
    if (persistKey && formData.name) {
      try {
        localStorage.setItem(STORAGE_PREFIX + persistKey, JSON.stringify(formData))
      } catch {
        // Ignore storage errors
      }
    }
  }, [formData, persistKey])

  // Clear draft after successful submission
  const clearDraft = useCallback(() => {
    if (persistKey) {
      try {
        localStorage.removeItem(STORAGE_PREFIX + persistKey)
      } catch {
        // Ignore storage errors
      }
    }
  }, [persistKey])

  // Auto-generate slug from name (only for new brands)
  useEffect(() => {
    if (!brand && formData.name) {
      setFormData(prev => ({
        ...prev,
        slug: generateSlug(prev.name),
      }))
    }
  }, [formData.name, brand])

  // Debounced slug-availability check via the check_brand_slug_available
  // RPC. Surfaces inline status so collisions don't explode at submit.
  // Skipped for existing brands (slug is immutable post-creation).
  useEffect(() => {
    if (brand) {
      setSlugStatus('idle')
      return
    }
    const trimmed = formData.slug.trim()
    if (!trimmed) {
      setSlugStatus('idle')
      return
    }
    const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
    if (!slugPattern.test(trimmed) || RESERVED_SLUGS.has(trimmed)) {
      setSlugStatus('invalid')
      return
    }
    setSlugStatus('checking')
    const handle = window.setTimeout(async () => {
      try {
        // RPC type cast: Supabase generated types haven't been refreshed
        // since migration 20260501120000 added this function. Casting to
        // `never` lets us call it without regenerating types just for one
        // helper. Server-side validation is still authoritative.
        const { data, error: rpcError } = await supabase.rpc('check_brand_slug_available' as never, { p_slug: trimmed } as never) as { data: boolean | null; error: unknown }
        if (rpcError) {
          // Network / RPC failure — stay 'checking' is wrong, set to 'idle'
          // so the user isn't blocked. Submit-time check is authoritative.
          setSlugStatus('idle')
          return
        }
        setSlugStatus(data ? 'available' : 'taken')
      } catch {
        setSlugStatus('idle')
      }
    }, 350)
    return () => window.clearTimeout(handle)
  }, [formData.slug, brand])

  const handleLogoUpload = useCallback(async (file: File) => {
    if (!user) return

    try {
      setUploadingLogo(true)
      setError(null)

      // Validate the image
      const validation = validateImage(file, { maxFileSizeMB: 10 })
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // Optimize the image
      const optimizedBlob = await optimizeAvatarImage(file)

      // Generate a unique filename
      const fileExt = 'webp'
      const fileName = `${user.id}/brand-logo-${Date.now()}.${fileExt}`

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, optimizedBlob, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000',
        })

      if (uploadError) {
        throw uploadError
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName)

      setFormData(prev => ({
        ...prev,
        logo_url: urlData.publicUrl,
      }))
    } catch (err) {
      logger.error('[BrandForm] Error uploading logo:', err)
      setError(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }, [user])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleLogoUpload(file)
    }
  }

  const handleLogoClick = useCallback(async () => {
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt')
        if (result) {
          await handleLogoUpload(result.file)
        }
      } catch (err) {
        logger.error('[BrandForm] Native image picker error:', err)
        setError('Could not access camera or photos. Please check app permissions.')
      }
      return
    }
    fileInputRef.current?.click()
  }, [handleLogoUpload])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim()) {
      setError('Brand name is required')
      return
    }

    if (!formData.category) {
      setError('Please choose a category for your brand.')
      return
    }

    if (!formData.country_id) {
      setError('Please choose a country for your brand.')
      return
    }

    const trimmedSlug = formData.slug.trim()
    if (!trimmedSlug) {
      setError('Brand URL slug is required')
      return
    }

    // Only validate slug rules on creation — existing brands cannot change their slug
    if (!brand) {
      if (RESERVED_SLUGS.has(trimmedSlug)) {
        setError('That URL slug is reserved. Please pick another.')
        return
      }

      // Same regex as server-side validation in create_brand RPC
      const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
      if (!slugPattern.test(trimmedSlug)) {
        setError('URL slug must be lowercase letters, numbers, and hyphens only (no leading or trailing hyphen).')
        return
      }

      // Pre-flight collision guard. The check_brand_slug_available RPC
      // result is already surfaced inline via slugStatus; if it landed on
      // 'taken' or 'invalid' since the user last typed, block submit with
      // a clear message instead of letting it explode at create_brand time.
      if (slugStatus === 'taken') {
        setError('That URL is already taken. Please choose another.')
        return
      }
      if (slugStatus === 'invalid') {
        setError('That URL is not valid. Use lowercase letters, numbers and hyphens only.')
        return
      }
    }

    // Validate optional URL fields at submit time. The onBlur handler
    // already shows inline errors, but a user who never blurred (e.g.
    // pasted then clicked Save) wouldn't have triggered the validation.
    const websiteValidation = validateBrandUrl(formData.website_url)
    if (websiteValidation) {
      setWebsiteError(websiteValidation)
      setError('Please fix the website URL before saving.')
      return
    }
    const instagramValidation = validateBrandUrl(formData.instagram_url)
    if (instagramValidation) {
      setInstagramError(instagramValidation)
      setError('Please fix the Instagram URL before saving.')
      return
    }

    try {
      // formData.category was narrowed to BrandCategory by the empty-string
      // check above; cast to satisfy the onSubmit signature (which still
      // requires the strict BrandCategory union).
      await onSubmit({ ...formData, category: formData.category as BrandCategory })
      clearDraft() // Clear saved draft on successful submission
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brand')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Logo Upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Brand Logo
        </label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleLogoClick}
            disabled={uploadingLogo}
            className="w-24 h-24 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors overflow-hidden relative"
          >
            {uploadingLogo ? (
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            ) : formData.logo_url ? (
              <img
                src={formData.logo_url}
                alt="Brand logo"
                className="w-full h-full object-contain p-2"
              />
            ) : (
              <Camera className="w-8 h-8 text-gray-400" />
            )}
          </button>
          <div className="text-sm text-gray-500">
            <p>Click to upload your brand logo</p>
            <p>Recommended: Square image, at least 200x200px</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          aria-label="Upload brand logo"
        />
      </div>

      {/* Brand Name */}
      <div>
        <label htmlFor="brand-name" className="block text-sm font-medium text-gray-700 mb-1">
          Brand Name *
        </label>
        <Input
          id="brand-name"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="Enter your brand name"
          required
        />
      </div>

      {/* URL Slug */}
      <div>
        <label htmlFor="brand-slug" className="block text-sm font-medium text-gray-700 mb-1">
          URL Slug *
        </label>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-sm">inhockia.com/brands/</span>
          <Input
            id="brand-slug"
            value={formData.slug}
            onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
            placeholder="your-brand"
            required
            disabled={!!brand} // Slug cannot be changed after creation
          />
        </div>
        {!brand && (
          <p className="mt-1 text-xs text-gray-500">
            This will be your brand's unique URL. It cannot be changed later.
          </p>
        )}
        {!brand && slugStatus === 'checking' && (
          <p className="mt-1 text-xs text-gray-400">Checking availability…</p>
        )}
        {!brand && slugStatus === 'available' && (
          <p className="mt-1 text-xs text-emerald-600">✓ Available</p>
        )}
        {!brand && slugStatus === 'taken' && (
          <p className="mt-1 text-xs text-red-600">
            That URL is already taken. Try a different one.
          </p>
        )}
        {!brand && slugStatus === 'invalid' && (
          <p className="mt-1 text-xs text-red-600">
            URL must be lowercase letters, numbers and hyphens only (no leading/trailing hyphen).
          </p>
        )}
      </div>

      {/* Category */}
      <div>
        <label htmlFor="brand-category" className="block text-sm font-medium text-gray-700 mb-1">
          Category *
        </label>
        <select
          id="brand-category"
          value={formData.category}
          onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as BrandCategory | '' }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          required
        >
          {/* Explicit placeholder so brands don't silently land on
              "Equipment" without realising. Browsers won't let `required`
              submit while value=""; submit-time validation also catches it. */}
          <option value="" disabled>Choose a category…</option>
          {CATEGORY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Country — required so the brand is discoverable in country-filtered
          surfaces (Hockia AI search, marketplace, etc.). Migration 20260525120000
          added the column + backfilled 8 existing brands. Without this field
          set, the brand would be invisible to every country filter. */}
      <CountrySelect
        label="Country *"
        value={formData.country_id}
        onChange={(country_id) => setFormData(prev => ({ ...prev, country_id }))}
        placeholder="Where is your brand based?"
        required
      />

      {/* Bio */}
      <div>
        <label htmlFor="brand-bio" className="flex items-center justify-between text-sm font-medium text-gray-700 mb-1">
          <span>About</span>
          <span className="text-xs font-normal text-gray-400">{formData.bio.length}/2000</span>
        </label>
        <textarea
          id="brand-bio"
          value={formData.bio}
          onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value.slice(0, 2000) }))}
          placeholder="Tell us about your brand..."
          rows={4}
          maxLength={2000}
          autoCapitalize="sentences"
          spellCheck
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Website */}
      <div>
        <label htmlFor="brand-website" className="block text-sm font-medium text-gray-700 mb-1">
          Website
        </label>
        <Input
          id="brand-website"
          type="text"
          value={formData.website_url}
          onChange={(e) => {
            setFormData(prev => ({ ...prev, website_url: e.target.value }))
            if (websiteError) setWebsiteError(null)
          }}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
              setFormData(prev => ({ ...prev, website_url: `https://${value}` }))
            }
            // Validate after auto-prefix so we evaluate the canonical shape.
            setWebsiteError(validateBrandUrl(value))
          }}
          placeholder="www.your-brand.com"
        />
        {websiteError && (
          <p className="mt-1 text-xs text-red-600">{websiteError}</p>
        )}
      </div>

      {/* Instagram */}
      <div>
        <label htmlFor="brand-instagram" className="block text-sm font-medium text-gray-700 mb-1">
          Instagram
        </label>
        <Input
          id="brand-instagram"
          type="text"
          value={formData.instagram_url}
          onChange={(e) => {
            setFormData(prev => ({ ...prev, instagram_url: e.target.value }))
            if (instagramError) setInstagramError(null)
          }}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
              setFormData(prev => ({ ...prev, instagram_url: `https://${value}` }))
            }
            setInstagramError(validateBrandUrl(value))
          }}
          placeholder="instagram.com/yourbrand"
        />
        {instagramError && (
          <p className="mt-1 text-xs text-red-600">{instagramError}</p>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-4">
        <Button
          type="submit"
          disabled={isSubmitting || uploadingLogo}
          className="w-full"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  )
}

export default BrandForm
