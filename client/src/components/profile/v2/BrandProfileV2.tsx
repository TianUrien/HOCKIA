import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera, Check, ChevronRight, Lock, MessageCircle, Package, Plus, Settings, Share, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import type { BrandProduct } from '@/hooks/useBrandProducts'
import type { BrandPost } from '@/hooks/useBrandPosts'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { hasAnalyticsConsent } from '@/lib/cookieConsent'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { GLASS, initialsOf } from '@/lib/communityCard'
import { positionLabel } from '@/lib/identity'
import { instagramHandleOf } from '@/lib/brandEdit'
import { nextStepPart, NEXT_STEP_COPY, type CompletenessPart } from '@/lib/profileV2'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import VerifiedBadge from '@/components/VerifiedBadge'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BlurImage } from '@/components/home/v1/BlurImage'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import { cn } from '@/lib/utils'
import { useQueuedToggle } from '@/hooks/useQueuedToggle'
import pitchHorizontal from '@/assets/community/pitch-full-horizontal.svg'
import { CompactHeader, SectionAnchors } from './ProfileChrome'
import { useScrolledPast } from './profileChromeHooks'
import { OwnerButtons, PrimaryCard } from './OwnerArea'
import { type ActionBarButton } from './ProfileActionBar'
import { ProfileLayout } from './ProfileLayout'
import { PostsPhotosGrid, Section, type GridTile } from './ProfileSections'
import { BackGlyph } from '@/components/ui/BackGlyph'

/**
 * Profile v2 — brand, phone (Figma PR9 public 111:446 · PR13 own 116:654 ·
 * PR16 new 120:1292). Cover hero (brands.cover_url) with the logo tile, then
 * Products → Ambassadors → Latest updates → About. Brands have followers, not
 * friends: the bar is Follow + Message. Own adds the ambassador card
 * (brand-initiated invites), private stats incl. taps to your store, and the
 * "Open to partners" switch. A product tap counts only with analytics consent.
 */
export interface BrandV2 {
  id: string
  profile_id: string
  slug: string
  name: string
  logo_url: string | null
  cover_url?: string | null
  open_to_partners?: boolean
  bio: string | null
  category: string
  country_id: number | null
  website_url: string | null
  instagram_url: string | null
  is_verified: boolean
}

export interface BrandAmbassadorFace {
  player_id: string
  full_name: string | null
  avatar_url: string | null
  position: string | null
  role?: string | null
}

export interface BrandProfileV2Props {
  brand: BrandV2
  owner: boolean
  products: BrandProduct[]
  posts: BrandPost[]
  ambassadors: BrandAmbassadorFace[]
  ambassadorTotal: number
  followerCount: number
  // Visitor
  isFollowing?: boolean
  followBusy?: boolean
  onFollow?: () => void
  onMessage?: () => void
  canMessage?: boolean
  sendingMessage?: boolean
  // Owner
  pendingInvites?: Array<{ full_name: string | null; avatar_url: string | null }>
  onEdit?: () => void
  onViewPublic?: () => void
  onInvite?: () => void
  onViewInvites?: () => void
  onAddProduct?: () => void
  onEditProduct?: (p: BrandProduct) => void
  onPostUpdate?: () => void
  onTogglePartners?: (next: boolean) => Promise<void> | void
  onOpenTab?: (tab: 'products' | 'posts' | 'ambassadors' | 'followers') => void
}

const ANCHORS = [
  { id: 'products', label: 'Products' },
  { id: 'ambassadors', label: 'Ambassadors' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
]

const SCRIM =
  'linear-gradient(180deg, rgba(15,15,20,0) 35%, rgba(15,15,20,0.017) 45.8%, rgba(15,15,20,0.133) 56.7%, rgba(15,15,20,0.45) 67.5%, rgba(15,15,20,0.767) 78.3%, rgba(15,15,20,0.883) 89.2%, rgba(15,15,20,0.9) 100%), linear-gradient(180deg, rgba(15,15,20,0.45) 0%, rgba(15,15,20,0) 22%)'
const BRAND_GRADIENT = 'linear-gradient(152deg, rgb(108, 43, 217) 7%, rgb(52, 18, 120) 79%)'
const GLASS_BTN = cn('flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] text-white', GLASS)

function categoryLabel(c: string | null | undefined): string | null {
  if (!c) return null
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function firstImage(p: BrandProduct): string | null {
  const imgs = [...(p.images ?? [])].sort((a, b) => a.order - b.order)
  return imgs[0]?.url ?? null
}

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 text-[14px] leading-[19px]">
      <span className="flex-1 text-ink-2">{label}</span>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-right font-semibold text-hockia-primary">{value}</a>
        : <span className="min-w-0 truncate text-right font-semibold text-ink-1">{value}</span>}
    </div>
  )
}

export default function BrandProfileV2(props: BrandProfileV2Props) {
  const { brand, owner } = props
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const { countries } = useCountries()
  const heroRef = useRef<HTMLDivElement>(null)
  const compact = useScrolledPast(heroRef)
  const [bioOpen, setBioOpen] = useState(false)
  const [viewersOpen, setViewersOpen] = useState(false)
  // Home's views card links here with ?viewers=1 (ruling 2026-10-16): open who viewed you.
  useEffect(() => {
    if (!owner) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('viewers') !== '1') return
    setViewersOpen(true)
    params.delete('viewers')
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }, [owner])

  const country = countries.find((c) => c.id === brand.country_id) ?? null
  const countryName = country ? (country.common_name ?? country.name) : null
  const placeLine = countryName ? [country?.flag_emoji, countryName].filter(Boolean).join(' ') : null
  const category = categoryLabel(brand.category)
  const cover = brand.cover_url ?? null
  const logo = brand.logo_url ? getImageUrl(brand.logo_url, 'avatar-md') ?? brand.logo_url : null
  const instagram = instagramHandleOf(brand.instagram_url)
  const bio = brand.bio?.trim() || null

  const share = async () => {
    const url = `${window.location.origin}/brands/${brand.slug}`
    try {
      if (navigator.share) { await navigator.share({ title: brand.name, url }); return }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[BrandProfileV2] share failed', err)
    }
  }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/community/brands'))

  // A product tap: counted (consent-gated, never the brand's own), then the store.
  const openProduct = (p: BrandProduct) => {
    if (owner) { props.onEditProduct?.(p); return }
    // Only a tap that actually opens the store counts (QA F7).
    if (!p.external_url) return
    if (hasAnalyticsConsent()) trackDbEvent('brand_product_click', 'brand_product', p.id, { brand_id: brand.id })
    window.open(/^https?:\/\//i.test(p.external_url) ? p.external_url : `https://${p.external_url}`, '_blank', 'noopener,noreferrer')
  }

  // ── Own: next step, stats, taps ─────────────────────────────────────────
  const completeness = useQuery({
    queryKey: ['profile-completeness', brand.profile_id],
    enabled: owner,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: res, error } = await supabase.rpc('get_my_profile_completeness')
      if (error) throw error
      return res as unknown as { pct: number; parts: CompletenessPart[] }
    },
  })
  const step = owner ? nextStepPart(completeness.data?.parts) : null
  const stepCopy = step ? NEXT_STEP_COPY[step.key] : null
  const taps = useQuery({
    queryKey: ['product-tap-stats', brand.id],
    enabled: owner,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_product_tap_stats', { p_days: 7 })
      if (error) throw error
      return data as unknown as { total: number; products: Array<{ product_id: string; taps: number }> }
    },
  })
  const tapsByProduct = useMemo(() => new Map((taps.data?.products ?? []).map((t) => [t.product_id, t.taps])), [taps.data])
  const vis = useWeeklyVisibility(owner, false)
  const searches = useSearchAppearances({ profileId: owner ? brand.profile_id : null })
  const pending = props.pendingInvites ?? []
  // One primary per screen: invites waiting own it; else the next step does.
  const invitesPrimary = pending.length > 0 || !stepCopy

  // Each tap shows at once; saves run one after another (QA F4).
  const partners = useQueuedToggle(Boolean(brand.open_to_partners), async (next) => { await props.onTogglePartners?.(next) })

  // ── Updates grid ────────────────────────────────────────────────────────
  const tiles: GridTile[] = useMemo(() => props.posts.map((post) => ({
    kind: 'post' as const, id: post.id, url: post.image_url, text: post.content, multi: false, video: false, at: post.created_at,
    onOpen: () => props.onOpenTab?.('posts'),
  })), [props])

  // ── Visitor bar: Follow + Message (brands have no friends) ─────────────
  const followButton: ActionBarButton = props.isFollowing
    ? { key: 'follow', label: 'Following', icon: <Check className="h-5 w-5" strokeWidth={2.4} />, tone: 'done', onClick: props.onFollow, disabled: props.followBusy, testId: 'brand-follow' }
    : { key: 'follow', label: 'Follow', icon: <UserPlus className="h-5 w-5" strokeWidth={2} />, tone: 'primary', onClick: props.onFollow, disabled: props.followBusy, testId: 'brand-follow' }
  const messageButton: ActionBarButton = { key: 'message', label: props.sendingMessage ? 'Opening…' : 'Message', icon: <MessageCircle className="h-5 w-5" strokeWidth={1.8} />, tone: 'secondary', onClick: props.onMessage, disabled: props.sendingMessage, testId: 'brand-message' }
  const buttons: ActionBarButton[] = owner ? [] : props.canMessage ? [followButton, messageButton] : [followButton]

  const moreMenu = (cls: string) => (!owner ? <ProfileActionMenu targetId={brand.profile_id} targetName={brand.name} triggerClassName={cls} iconClassName="h-[22px] w-[22px]" /> : null)

  const anchors = ANCHORS.filter((a) => (
    a.id === 'products' ? owner || props.products.length > 0
      : a.id === 'ambassadors' ? owner || props.ambassadorTotal > 0
        : a.id === 'updates' ? owner || tiles.length > 0
          : true
  ))

  return (
    <div className="bg-white pb-8" data-testid="brand-profile-v2">
      <CompactHeader name={brand.name} avatarUrl={brand.logo_url} role="brand" visible={compact} owner={owner} onBack={back} onShare={() => void share()} right={moreMenu('flex h-11 w-11 items-center justify-center text-ink-1')} />

      {/* Hero */}
      <ProfileLayout actions={buttons} hero={<div ref={heroRef}>
        <section className={cn('relative w-full overflow-hidden bg-ink-1', cover ? 'h-[480px] lg:h-[min(480px,max(400px,calc(100dvh-200px)))] xl:h-[min(640px,max(400px,calc(100dvh-200px)))]' : 'h-[360px] lg:h-[min(450px,max(400px,calc(100dvh-200px)))] xl:h-[min(600px,max(400px,calc(100dvh-200px)))]')} data-testid="brand-hero" style={cover ? undefined : { backgroundImage: BRAND_GRADIENT }}>
          {cover
            ? <BlurImage src={getImageUrl(cover, 'lightbox') ?? cover} lqip={getLqipUrl(cover)} eager className="absolute inset-0 h-full w-full" />
            // No cover (as the other roles): brand gradient + faint pitch lines, shorter hero.
            : <img src={pitchHorizontal} alt="" aria-hidden="true" className="absolute inset-x-0 top-[60px] h-[200px] w-full" />}
          {!cover && owner && (
            <button type="button" onClick={props.onEdit} className="absolute left-1/2 top-[38%] z-10 flex h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-white/50 bg-white/10 text-[13px] font-semibold text-white" data-testid="brand-hero-add-cover">
              <Camera className="h-6 w-6" strokeWidth={1.6} /> Add a cover
            </button>
          )}
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: SCRIM }} aria-hidden="true" />
          <div className="absolute inset-x-4 top-[max(env(safe-area-inset-top),12px)] flex items-center justify-between pt-1">
            {owner
              // With no cover the "Add a cover" circle is the one camera action.
              ? (cover ? <button type="button" onClick={props.onEdit} aria-label="Edit cover" className={GLASS_BTN}><Camera className="h-[22px] w-[22px]" strokeWidth={1.6} /></button> : <span />)
              : <button type="button" onClick={back} aria-label="Back" className={cn(GLASS_BTN, 'lg:invisible')}><BackGlyph className="h-[22px] w-[22px]" strokeWidth={1.8} /></button>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void share()} aria-label="Share brand" className={GLASS_BTN}><Share className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
              {owner
                ? <button type="button" onClick={() => navigate('/settings')} aria-label="Settings" className={GLASS_BTN}><Settings className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
                : moreMenu(GLASS_BTN)}
            </div>
          </div>
          <div className="absolute inset-x-4 bottom-6 flex flex-col items-start gap-1.5">
            <div className="relative">
              <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[20px] bg-white p-2 shadow-[0_10px_14px_rgba(15,15,20,0.1),0_1px_1px_rgba(15,15,20,0.06)]">
                {logo ? <img src={logo} alt="" className="h-14 w-14 object-contain" decoding="async" /> : <span className="text-[28px] font-bold text-[#be123c]">{initialsOf(brand.name).slice(0, 1)}</span>}
              </div>
              {owner && (
                <button type="button" onClick={props.onEdit} aria-label="Change logo" className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-hockia-primary text-white"><Camera className="h-3.5 w-3.5" strokeWidth={2} /></span>
                </button>
              )}
            </div>
            <div className="flex max-w-full items-center gap-2">
              <h1 className="min-w-0 truncate text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-white">{brand.name}</h1>
              <VerifiedBadge verified={brand.is_verified} className="shrink-0 text-white" />
            </div>
            {category && <p className="max-w-full truncate text-[15px] leading-5 text-white/90">{category}</p>}
            {placeLine && <p className="max-w-full truncate text-secondary text-white/85">{placeLine}</p>}
          </div>
          {brand.open_to_partners && (
            <span className={cn('absolute right-4 bottom-[132px] inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[rgba(15,15,20,0.35)] px-2.5 py-[5px] text-caption font-semibold text-white', GLASS)} data-testid="brand-partners-pill">
              <span className="h-[7px] w-[7px] rounded-full bg-[#4ade80]" aria-hidden="true" /> Looking for ambassadors
            </span>
          )}
        </section>
      </div>}>

      {owner && (
        <div className="flex flex-col gap-3">
          <OwnerButtons onEdit={() => props.onEdit?.()} previews={[{ key: 'public', label: 'Someone on Hockia', detail: 'What athletes and clubs see', onSelect: () => props.onViewPublic?.() }]} />
          {stepCopy && step && <PrimaryCard pct={completeness.data?.pct ?? null} title={stepCopy.title} subtitle={stepCopy.subtitle} cta={stepCopy.cta} onAction={() => (stepCopy.action.kind === 'route' ? navigate(stepCopy.action.to) : props.onEdit?.())} secondary={invitesPrimary} />}

          {/* Ambassador card — brand-initiated invites */}
          <div className="px-4">
            <div className={cn('flex flex-col gap-3 rounded-[24px] p-4', invitesPrimary ? 'bg-hockia-soft' : 'border border-line bg-white')} data-testid="brand-invites-card">
              <div className="flex items-center gap-3">
                {pending.length > 0 ? (
                  <span className="relative h-10 shrink-0" style={{ width: 40 + (Math.min(pending.length, 2) - 1) * 20 }} aria-hidden="true">
                    {pending.slice(0, 2).map((p, i) => (
                      <span key={i} className="absolute top-0" style={{ left: i * 20 }}><FaceCircle url={p.avatar_url} name={p.full_name} role="player" size="avatar-sm" initialsClassName="text-[12px]" className="h-10 w-10 ring-2 ring-white" /></span>
                    ))}
                  </span>
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-hockia-primary"><UserPlus className="h-5 w-5" strokeWidth={1.8} /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">
                    {pending.length > 0 ? `${pending.length} ${pending.length === 1 ? 'invite' : 'invites'} waiting for a reply` : 'Invite athletes to represent you'}
                  </span>
                  <span className="block truncate text-secondary text-ink-2">
                    {pending.length > 0 ? pending.slice(0, 2).map((p) => p.full_name ?? 'Athlete').join(' · ') : 'They accept from their inbox'}
                  </span>
                </span>
              </div>
              <div className="flex gap-2.5">
                <button type="button" onClick={props.onInvite} className={cn('flex h-11 flex-1 items-center justify-center rounded-full text-[16px] font-semibold', invitesPrimary ? 'bg-hockia-primary text-white' : 'border border-line bg-white text-hockia-primary')}>+ Invite athletes</button>
                {pending.length > 0 && <button type="button" onClick={props.onViewInvites} className="flex h-11 items-center justify-center rounded-full bg-white px-4 text-[16px] font-semibold text-hockia-primary">View invites</button>}
              </div>
            </div>
          </div>

          {/* Private stats */}
          <div className="px-4" data-testid="brand-private-stats">
            <div className="flex divide-x divide-line rounded-[20px] border border-line bg-white">
              {[
                { value: vis.visibility?.views_7d ?? 0, label: (vis.visibility?.views_7d ?? 0) === 1 ? 'profile view' : 'profile views' },
                { value: searches.summary?.total ?? 0, label: 'in searches' },
                { value: taps.data?.total ?? 0, label: (taps.data?.total ?? 0) === 1 ? 'tap to your store' : 'taps to your store' },
              ].map((s) => (
                <div key={s.label} className="flex flex-1 flex-col items-center py-3">
                  <span className="text-title tabular-nums text-ink-1">{s.value}</span>
                  <span className="text-caption text-ink-2">{s.label}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setViewersOpen(true)} className="mt-2 flex min-h-[32px] items-center gap-1 text-caption text-ink-3" data-testid="brand-see-viewers">
              <Lock className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> Only you see this · Last 7 days · See who viewed <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {/* Open to partners */}
          <div className="px-4">
            <div className="flex items-center gap-3 rounded-[20px] bg-surface-subtle px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">Open to partners</span>
                <span className="block text-secondary text-ink-2">Players and clubs see you’re looking for ambassadors</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={partners.value}
                aria-label="Open to partners"
                onClick={partners.toggle}
                className={cn('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200', partners.value ? 'bg-[#15803d]' : 'bg-gray-300')}
                data-testid="brand-partners-switch"
              >
                <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200', partners.value ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionAnchors items={anchors} />

      {/* Public: zero counts are hidden (owners see them in their private stats). */}
      {!owner && (props.followerCount > 0 || props.ambassadorTotal > 0 || brand.is_verified) && (
        <div className="flex gap-4 px-4 pt-3 text-secondary" data-testid="brand-follow-stats">
          {props.followerCount > 0 && <span className="font-semibold text-ink-1">{props.followerCount} {props.followerCount === 1 ? 'follower' : 'followers'}</span>}
          {props.ambassadorTotal > 0 && <span className="font-semibold text-ink-1">{props.ambassadorTotal} {props.ambassadorTotal === 1 ? 'ambassador' : 'ambassadors'}</span>}
          {brand.is_verified && <span className="text-ink-2">✓ Verified brand</span>}
        </div>
      )}

      {/* Products */}
      {(owner || props.products.length > 0) && (
        <Section id="products" title="Products" action={owner ? '+ Add product' : props.onOpenTab && props.products.length > 3 ? `See all ${props.products.length}` : null} onAction={owner ? props.onAddProduct : () => props.onOpenTab?.('products')}>
          <div className="flex gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {owner && (
              <button type="button" onClick={props.onAddProduct} className="flex h-[160px] w-[160px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 border-dashed border-hockia-primary/50 bg-hockia-soft/40 text-[15px] font-semibold text-hockia-primary" data-testid="brand-add-product">
                <Plus className="h-6 w-6" strokeWidth={2.2} /> Add product
              </button>
            )}
            {props.products.map((p) => {
              const img = firstImage(p)
              const n = tapsByProduct.get(p.id) ?? 0
              return (
                <button key={p.id} type="button" onClick={() => openProduct(p)} className="flex w-[160px] shrink-0 flex-col items-start gap-1.5 text-left" data-testid="brand-product">
                  <span className="relative block h-[160px] w-[160px] overflow-hidden rounded-[20px] border-[0.5px] border-[rgba(15,15,20,0.06)]" style={img ? undefined : { backgroundImage: 'linear-gradient(143deg, rgb(247,242,255) 14%, rgb(232,224,250) 86%)' }}>
                    {img ? <BlurImage src={getImageUrl(img, 'gallery') ?? img} lqip={getLqipUrl(img)} className="h-full w-full" /> : <span className="flex h-full w-full items-center justify-center text-hockia-primary/60"><Package className="h-10 w-10" strokeWidth={1.4} /></span>}
                  </span>
                  <span className="w-full truncate text-[14px] font-semibold leading-[19px] text-ink-1">{p.name}</span>
                  <span className="w-full truncate text-caption text-ink-2">
                    {owner ? `${n} ${n === 1 ? 'tap' : 'taps'}` : p.external_url ? 'View ↗' : (p.description?.trim() || ' ')}
                  </span>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {/* Ambassadors */}
      {(owner || props.ambassadorTotal > 0) && (
        <Section id="ambassadors" title={props.ambassadorTotal > 0 ? `Ambassadors · ${props.ambassadorTotal}` : 'Ambassadors'} action={owner ? '+ Invite' : props.onOpenTab && props.ambassadorTotal > props.ambassadors.length ? 'See all' : null} onAction={owner ? props.onInvite : () => props.onOpenTab?.('ambassadors')}>
          {props.ambassadors.length > 0 ? (
            <div className="flex gap-3.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {props.ambassadors.map((a) => (
                <button key={a.player_id} type="button" onClick={() => navigate(a.role === 'coach' ? `/coaches/id/${a.player_id}` : `/players/id/${a.player_id}`)} className="flex w-16 shrink-0 flex-col items-center gap-1" data-testid="brand-ambassador">
                  <FaceCircle url={a.avatar_url} name={a.full_name} role={a.role ?? 'player'} size="avatar-md" initialsClassName="text-[18px]" className="h-16 w-16" />
                  <span className="w-full truncate text-center text-secondary font-semibold text-ink-1">{(a.full_name ?? 'Athlete').split(/\s+/)[0]}</span>
                  <span className="w-full truncate text-center text-caption text-ink-3">{positionLabel(a.position) || 'Athlete'}</span>
                </button>
              ))}
            </div>
          ) : <p className="px-4 text-body text-ink-3">No ambassadors yet.</p>}
        </Section>
      )}

      {/* Latest updates */}
      {(owner || tiles.length > 0) && (
        <Section id="updates" title="Latest updates" action={owner ? '+ Post update' : props.onOpenTab && tiles.length > 6 ? 'See all' : null} onAction={owner ? props.onPostUpdate : () => props.onOpenTab?.('posts')}>
          {tiles.length > 0 ? <PostsPhotosGrid tiles={tiles} /> : <p className="px-4 text-body text-ink-3">No updates yet.</p>}
        </Section>
      )}

      {/* About */}
      <Section id="about" title="About" action={owner ? 'Edit' : null} onAction={props.onEdit}>
        <div className="flex flex-col items-start gap-1.5 px-4">
          {bio ? (
            <>
              <p className={cn('whitespace-pre-line text-body text-ink-1', !bioOpen && 'line-clamp-3')}>{bio}</p>
              {!bioOpen && bio.length > 140 && <button type="button" onClick={() => setBioOpen(true)} className="min-h-[32px] text-secondary font-semibold text-hockia-primary">More</button>}
            </>
          ) : owner ? <p className="text-body text-ink-3">No description yet</p> : null}
          <div className="w-full pt-2">
            {category && <DetailRow label="Category" value={category} />}
            {countryName && <DetailRow label="Country" value={countryName} />}
            {brand.website_url && <DetailRow label="Website" value={hostOf(brand.website_url)} href={/^https?:\/\//i.test(brand.website_url) ? brand.website_url : `https://${brand.website_url}`} />}
            {instagram && <DetailRow label="Instagram" value={`@${instagram}`} href={`https://instagram.com/${instagram}`} />}
          </div>
        </div>
      </Section>

      </ProfileLayout>
      {owner && (
        <BottomSheet open={viewersOpen} onClose={() => setViewersOpen(false)} ariaLabel="Profile views">
          <div className="px-1 pb-4">
            {(searches.summary?.total ?? 0) > 0 && (
              <p className="px-3 pb-2 text-secondary text-ink-2" data-testid="brand-viewers-searches">
                Your brand appeared in {searches.summary?.total} {searches.summary?.total === 1 ? 'search' : 'searches'} in the last 7 days.
              </p>
            )}
            <ProfileViewersSection />
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
