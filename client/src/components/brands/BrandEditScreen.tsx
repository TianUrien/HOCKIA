import { useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { SheetActions } from '@/components/settings/settingsUi'
import CountrySelect from '@/components/CountrySelect'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { optimizeAvatarImage, optimizeImage, validateImage } from '@/lib/imageOptimization'
import { getImageUrl } from '@/lib/imageUrl'
import { BRAND_CATEGORY_OPTIONS, instagramHandleOf, normalizeInstagram, validateBrandUrl } from '@/lib/brandEdit'
import type { BrandDetail } from '@/hooks/useBrand'
import type { UpdateBrandInput } from '@/hooks/useMyBrand'
import { cn } from '@/lib/utils'
import { useQueuedToggle } from '@/hooks/useQueuedToggle'
import { switchTrackClass } from '@/components/ui/switchClasses'
import RolePlaceholder from '@/components/RolePlaceholder'

/**
 * Edit profile — brand, phone (Figma PR22 130:1226). Logo and one cover at
 * the top, then grouped rows: Brand (name · role locked · category ·
 * country) · About (bio) · Partnerships (Open to partners) · Links (website
 * · Instagram). Each row opens a sheet and saves only that field through
 * update_brand (country since 20261012140000).
 */
type Field = 'name' | 'category' | 'country' | 'bio' | 'website' | 'instagram'

const TITLE: Record<Field, string> = { name: 'Brand name', category: 'Category', country: 'Country', bio: 'Bio', website: 'Website', instagram: 'Instagram' }
const BIO_MAX = 1000
const input = 'h-[50px] w-full rounded-[12px] bg-surface-grouped px-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30'

function Row({ label, value, onClick, locked, trailing }: { label: string; value: string | null; onClick?: () => void; locked?: boolean; trailing?: ReactNode }) {
  const body = (
    <>
      <span className="shrink-0 text-[15px] leading-5 text-ink-1">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-right text-[15px] leading-5', value ? (locked ? 'text-ink-3' : 'text-ink-2') : 'text-hockia-primary')}>{value ?? (trailing ? '' : 'Add')}</span>
      {trailing ?? (locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={2} aria-label="Locked" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />)}
    </>
  )
  const cls = 'flex h-[52px] w-full items-center gap-2 pl-4 pr-3 text-left'
  return onClick && !locked ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-[22px]">
      <h2 className="pb-1.5 text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">{label}</h2>
      <div className="divide-y-[0.5px] divide-line overflow-hidden rounded-[16px] bg-white">{children}</div>
    </section>
  )
}

export default function BrandEditScreen({ brand, onClose, onPreview, onSave }: {
  brand: BrandDetail
  onClose: () => void
  onPreview: () => void
  onSave: (patch: UpdateBrandInput) => Promise<{ success: boolean; error?: string }>
}) {
  const user = useAuthStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const { getCountryById } = useCountries()
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Field | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countryDraft, setCountryDraft] = useState<number | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)

  const partners = useQueuedToggle(
    Boolean(brand.open_to_partners),
    async (next) => (await onSave({ open_to_partners: next })).success,
    () => addToast('Could not save that. Please try again.', 'error'),
  )

  // One-tap saves (remove cover): one at a time, and say so when they fail.
  const quickSave = async (patch: UpdateBrandInput) => {
    if (quickBusy) return
    setQuickBusy(true)
    const res = await onSave(patch)
    setQuickBusy(false)
    if (!res.success) addToast(res.error ?? 'Could not save that. Please try again.', 'error')
  }

  const open = (field: Field) => {
    setError(null)
    setCountryDraft(brand.country_id ?? null)
    setDraft(field === 'name' ? brand.name : field === 'category' ? brand.category : field === 'bio' ? brand.bio ?? '' : field === 'website' ? brand.website_url ?? '' : brand.instagram_url ?? '')
    setEditing(field)
  }

  const persist = async (patch: UpdateBrandInput) => {
    setSaving(true)
    setError(null)
    const res = await onSave(patch)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save that. Please try again.'); return false }
    setEditing(null)
    return true
  }

  const save = async () => {
    const v = draft.trim()
    switch (editing) {
      case 'name': return v ? void persist({ name: v }) : setError('The brand name is required.')
      case 'category': return void persist({ category: v })
      case 'country': return countryDraft ? void persist({ country_id: countryDraft }) : setError('Choose a country.')
      case 'bio': return v.length > BIO_MAX ? setError(`Keep it under ${BIO_MAX} characters.`) : void persist({ bio: v })
      case 'website': {
        const urlError = validateBrandUrl(v)
        if (urlError) return setError(urlError)
        return void persist({ website_url: v && !/^https?:\/\//i.test(v) ? `https://${v}` : v })
      }
      case 'instagram': {
        const ig = normalizeInstagram(v)
        if (ig.error !== null) return setError(ig.error)
        return void persist({ instagram_url: ig.url })
      }
      default: return undefined
    }
  }

  const upload = async (kind: 'logo' | 'cover', file: File | undefined) => {
    if (!file || !user) return
    const check = validateImage(file, { maxFileSizeMB: kind === 'logo' ? 10 : 15 })
    if (!check.valid) { addToast(check.error ?? 'Invalid image', 'error'); return }
    setUploading(kind)
    try {
      const optimized = kind === 'logo' ? await optimizeAvatarImage(file) : await optimizeImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.85 })
      const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
      const path = `${user.id}/brand-${kind}-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, optimized, { contentType: optimized.type, upsert: true, cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const res = await onSave(kind === 'logo' ? { logo_url: url } : { cover_url: url })
      if (!res.success) throw new Error(res.error)
    } catch (err) {
      logger.error('[BrandEditScreen] upload failed', err)
      addToast('We couldn’t upload this image. Please use PNG or JPG.', 'error')
    } finally {
      setUploading(null)
    }
  }

  const country = brand.country_id ? getCountryById(brand.country_id) : undefined
  const countryValue = country ? [country.flag_emoji, country.common_name ?? country.name].filter(Boolean).join(' ') : null
  const categoryLabel = BRAND_CATEGORY_OPTIONS.find((c) => c.value === brand.category)?.label ?? null
  const host = (u: string | null) => (u ? u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') : null)
  const igHandle = instagramHandleOf(brand.instagram_url)
  const instagram = igHandle ? `@${igHandle}` : null
  const logo = brand.logo_url ? getImageUrl(brand.logo_url, 'avatar-md') ?? brand.logo_url : null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface-subtle pb-10 lg:hidden" data-testid="brand-edit-screen">
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar
          parent="Preview"
          title="Edit profile"
          showParent
          onBack={onPreview}
          trailing={<button type="button" onClick={onClose} className="h-11 px-3 text-body font-semibold text-hockia-primary">Done</button>}
        />
      </div>

      {/* Media: logo + one cover (tap to change) */}
      <div className="flex flex-col gap-2.5 bg-white p-4">
        <div className="flex items-center gap-3.5">
          <button type="button" onClick={() => logoRef.current?.click()} disabled={uploading !== null} className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[20px] ${logo ? 'border border-line bg-white' : ''}`} aria-label="Change logo">
            {logo ? <img src={logo} alt="" className="h-14 w-14 object-contain" /> : <RolePlaceholder role="brand" label="" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold leading-[21px] text-ink-1">Brand logo</p>
            <button type="button" onClick={() => logoRef.current?.click()} disabled={uploading !== null} className="text-secondary font-semibold text-hockia-primary disabled:opacity-60">{uploading === 'logo' ? 'Uploading…' : brand.logo_url ? 'Change' : 'Add'}</button>
          </div>
        </div>
        <p className="text-[16px] font-semibold leading-[21px] text-ink-1">Cover photo</p>
        <button type="button" onClick={() => coverRef.current?.click()} disabled={uploading !== null} className="relative flex h-[140px] w-full items-center justify-center overflow-hidden rounded-[12px] bg-surface-grouped text-secondary font-semibold text-hockia-primary" data-testid="brand-edit-cover">
          {uploading === 'cover' ? 'Uploading…' : brand.cover_url ? <img src={getImageUrl(brand.cover_url, 'feed-full') ?? brand.cover_url} alt="" className="h-full w-full object-cover" /> : 'Add a cover photo'}
        </button>
        <p className="text-caption text-ink-3">Tap the cover to change it. It shows at the top of your brand page.</p>
        {brand.cover_url && <button type="button" onClick={() => void quickSave({ cover_url: '' })} disabled={quickBusy} className="self-start text-caption font-semibold text-red-600">Remove cover</button>}
        <input ref={logoRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void upload('logo', e.target.files?.[0]); e.target.value = '' }} />
        <input ref={coverRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void upload('cover', e.target.files?.[0]); e.target.value = '' }} />
      </div>

      <Group label="Brand">
        <Row label="Brand name" value={brand.name} onClick={() => open('name')} />
        <Row label="Role" value="Brand" locked />
        <Row label="Category" value={categoryLabel} onClick={() => open('category')} />
        <Row label="Country" value={countryValue} onClick={() => open('country')} />
      </Group>

      <Group label="About">
        <Row label="Bio" value={brand.bio?.trim() || null} onClick={() => open('bio')} />
      </Group>

      <Group label="Partnerships">
        <Row
          label="Open to partners"
          value={null}
          trailing={
            <button
              type="button"
              role="switch"
              aria-checked={partners.value}
              aria-label="Open to partners"
              onClick={partners.toggle}
              className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200', switchTrackClass(partners.value))}
              data-testid="brand-edit-partners"
            >
              <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200', partners.value ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
            </button>
          }
        />
      </Group>

      <Group label="Links">
        <Row label="Website" value={host(brand.website_url)} onClick={() => open('website')} />
        <Row label="Instagram" value={instagram} onClick={() => open('instagram')} />
      </Group>

      <BottomSheet open={editing !== null} onClose={() => { if (!saving) setEditing(null) }} ariaLabel={editing ? TITLE[editing] : 'Edit'}>
        {editing && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-title text-ink-1">{TITLE[editing]}</h2>
            <div className="mt-3 flex flex-col gap-4">
              {editing === 'name' && <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Brand name" className={input} />}
              {editing === 'category' && (
                <select value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Category" className={input}>
                  {BRAND_CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              )}
              {editing === 'country' && <CountrySelect appearance="field" label="Country" value={countryDraft} onChange={(id) => setCountryDraft(id)} />}
              {editing === 'bio' && <textarea autoFocus value={draft} maxLength={BIO_MAX} rows={7} onChange={(e) => setDraft(e.target.value)} aria-label="Bio" placeholder="What you make and who it’s for." className="w-full rounded-[12px] bg-surface-grouped p-3.5 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30" />}
              {editing === 'website' && <input autoFocus type="url" inputMode="url" autoCapitalize="none" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="yourbrand.com" aria-label="Website" className={input} />}
              {editing === 'instagram' && <input autoFocus autoCapitalize="none" autoCorrect="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="@yourbrand" aria-label="Instagram" className={input} />}
              {error && <p role="alert" className="text-secondary text-red-600">{error}</p>}
              <SheetActions onCancel={() => setEditing(null)} onSave={() => void save()} saving={saving} />
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
