import { supabase } from '@/lib/supabase'
import { invalidateProfile } from '@/lib/profile'
import { useAuthStore } from '@/lib/auth'
import { validateImage } from '@/lib/imageOptimization'
import { profilePhotoFields, uploadProfilePhoto } from '@/lib/profilePhoto'
import type { SocialPlatform } from '@/lib/socialLinks'
import { tHome } from '@/i18n/ns/home'

/**
 * Hockia AI next steps (founder, 2026-10-18): the agent looks at what a
 * profile is missing, recommends the step that helps most, and does it with
 * the member — a profile photo, the bio, links — asking with ready-made
 * options. Nothing is saved until the member confirms.
 */

export type StepKey = 'photo' | 'bio' | 'video' | 'career' | 'links' | 'position' | 'passport'

export interface NextStep { key: StepKey; label: string; description: string }

export interface ProfileFacts {
  role: string | null
  avatar_url: string | null
  bio: string | null
  highlight_video_url: string | null
  social_links: Record<string, string> | null
  position: string | null
  nationality_country_id: number | null
  careerCount: number
  galleryPhotos: { id: string; url: string }[]
}

/** A bio shorter than this reads unfinished: offer to improve it. */
export const BIO_SHORT = 80

/** What to do next, most useful first: photo, (players) passports, bio, video, clubs, links, position. */
export function nextStepsFrom(f: ProfileFacts): NextStep[] {
  const player = f.role === 'player'
  const out: NextStep[] = []
  if (!f.avatar_url) {
    out.push({ key: 'photo', label: tHome('aiNextSteps.photo.label'), description: f.galleryPhotos.length ? tHome('aiNextSteps.photo.fromGallery') : tHome('aiNextSteps.photo.description') })
  }
  // Players: passports right after the photo — clubs filter on nationality and EU (founder, 2026-10-18).
  const passport: NextStep = { key: 'passport', label: tHome('aiNextSteps.passport.label'), description: player ? tHome('aiNextSteps.passport.descriptionPlayer') : tHome('aiNextSteps.passport.description') }
  if (player && !f.nationality_country_id) out.push(passport)
  const bio = (f.bio ?? '').trim()
  if (!bio) out.push({ key: 'bio', label: tHome('aiNextSteps.bio.label'), description: tHome('aiNextSteps.bio.description') })
  else if (bio.length < BIO_SHORT) out.push({ key: 'bio', label: tHome('aiNextSteps.improveBio.label'), description: tHome('aiNextSteps.improveBio.description') })
  if (player && !f.highlight_video_url) out.push({ key: 'video', label: tHome('aiNextSteps.video.label'), description: tHome('aiNextSteps.video.description') })
  if (f.careerCount === 0) out.push({ key: 'career', label: tHome('aiNextSteps.career.label'), description: tHome('aiNextSteps.career.description') })
  if (!Object.values(f.social_links ?? {}).some((v) => typeof v === 'string' && v.trim())) out.push({ key: 'links', label: tHome('aiNextSteps.links.label'), description: tHome('aiNextSteps.links.description') })
  if (player && !f.position) out.push({ key: 'position', label: tHome('aiNextSteps.position.label'), description: tHome('aiNextSteps.position.description') })
  if (!player && !f.nationality_country_id) out.push(passport)
  return out
}

export async function loadProfileFacts(userId: string): Promise<ProfileFacts> {
  const [{ data: p, error }, { count }, { data: photos }] = await Promise.all([
    supabase.from('profiles').select('role, avatar_url, bio, highlight_video_url, social_links, position, nationality_country_id').eq('id', userId).maybeSingle(),
    supabase.from('career_history').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('gallery_photos').select('id, photo_url').eq('user_id', userId).order('order_index', { ascending: false }).limit(6),
  ])
  if (error) throw error
  const q = (p ?? {}) as Partial<Omit<ProfileFacts, 'careerCount' | 'galleryPhotos'>>
  return {
    role: q.role ?? null,
    avatar_url: q.avatar_url ?? null,
    bio: q.bio ?? null,
    highlight_video_url: q.highlight_video_url ?? null,
    social_links: (q.social_links as Record<string, string> | null) ?? null,
    position: q.position ?? null,
    nationality_country_id: q.nationality_country_id ?? null,
    careerCount: count ?? 0,
    galleryPhotos: ((photos ?? []) as { id: string; photo_url: string }[]).map((g) => ({ id: g.id, url: g.photo_url })),
  }
}

async function afterSave(userId: string, reason: string) {
  await invalidateProfile({ userId, reason })
  await useAuthStore.getState().refreshProfile().catch(() => { /* the next load picks it up */ })
  window.dispatchEvent(new Event('hockia:profile-updated'))
}

// ── Photo ──────────────────────────────────────────────────────────────────

/** Upload a photo as the profile photo. The old file is left for the nightly orphan sweep. */
export async function setAvatarFromFile(userId: string, file: File): Promise<string> {
  const check = validateImage(file, { maxFileSizeMB: 10 })
  if (!check.valid) throw new Error(check.error || tHome('aiNextSteps.photo.invalidFile'))
  const urls = await uploadProfilePhoto(userId, file)
  const { error } = await supabase.from('profiles').update(profilePhotoFields(urls)).eq('id', userId)
  if (error) throw error
  await afterSave(userId, 'hockia-ai-photo')
  return urls.avatarUrl
}

/** Use one of the member's gallery photos as the profile photo (copied into avatars). */
export async function setAvatarFromUrl(userId: string, url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`photo ${res.status}`)
  const blob = await res.blob()
  const type = blob.type === 'image/png' ? 'image/png' : blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  return setAvatarFromFile(userId, new File([blob], `gallery.${type.split('/')[1]}`, { type }))
}

// ── Bio ────────────────────────────────────────────────────────────────────

export type BioFocus = 'experience' | 'next' | 'style' | 'custom'
export const BIO_MAX = 600
export interface BioDraft { angle: string; bio: string }
export type BioResult = { drafts: BioDraft[]; reason?: 'limit' | 'unavailable' }

export async function draftBio(focus: BioFocus, note?: string): Promise<BioResult> {
  const { data, error } = await supabase.functions.invoke('profile-bio', { body: { focus, note } })
  if (error) return { drafts: [], reason: 'unavailable' }
  const r = data as { drafts?: BioDraft[]; reason?: BioResult['reason'] }
  return { drafts: Array.isArray(r?.drafts) ? r.drafts : [], reason: r?.reason }
}

export async function saveBio(userId: string, bio: string): Promise<void> {
  const text = bio.trim().slice(0, 1500)
  const { error } = await supabase.from('profiles').update({ bio: text || null }).eq('id', userId)
  if (error) throw error
  await afterSave(userId, 'hockia-ai-bio')
}

// ── Links ──────────────────────────────────────────────────────────────────

export type LinkKind = { kind: 'video'; url: string } | { kind: 'social'; platform: SocialPlatform; url: string } | { kind: 'invalid' }

const SOCIAL_HOSTS: [RegExp, SocialPlatform][] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(x|twitter)\.com$/, 'twitter'],
  [/(^|\.)(facebook|fb)\.com$/, 'facebook'],
]

/** What a pasted link is: a highlights video, a social profile, or neither. */
export function classifyProfileLink(input: string): LinkKind {
  const raw = input.trim()
  if (!raw || raw.length > 500) return { kind: 'invalid' }
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return { kind: 'invalid' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'invalid' }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  const url = `https://${u.hostname.toLowerCase()}${u.pathname}${u.search}`.replace(/\/$/, '')
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host)) return { kind: 'video', url }
  for (const [re, platform] of SOCIAL_HOSTS) {
    // A profile, not the site's home page.
    if (re.test(host)) return u.pathname.replace(/\//g, '').length > 1 ? { kind: 'social', platform, url } : { kind: 'invalid' }
  }
  return { kind: 'invalid' }
}

/** Save a link the member confirmed: a video becomes the highlights video, a social fills its slot. */
export async function saveProfileLink(userId: string, link: Exclude<LinkKind, { kind: 'invalid' }>): Promise<void> {
  if (link.kind === 'video') {
    const { error } = await supabase.from('profiles').update({ highlight_video_url: link.url }).eq('id', userId)
    if (error) throw error
  } else {
    const { data, error: readErr } = await supabase.from('profiles').select('social_links').eq('id', userId).maybeSingle()
    if (readErr) throw readErr
    const social = { ...((data?.social_links as Record<string, string> | null) ?? {}), [link.platform]: link.url }
    const { error } = await supabase.from('profiles').update({ social_links: social }).eq('id', userId)
    if (error) throw error
  }
  await afterSave(userId, 'hockia-ai-link')
}
