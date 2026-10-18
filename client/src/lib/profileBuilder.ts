import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { invalidateProfile } from '@/lib/profile'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { clearCoverPhotoCache } from '@/hooks/useCoverPhoto'
import { clearProfileScrollCache } from '@/hooks/useProfileScrollData'

/**
 * Hockia AI · "Fill my profile for me" (handoff P0–P3, Figma 185:309 /
 * 185:378 / 185:452 / 185:551). The member types their career, attaches a CV
 * (PDF), photos and links; the profile-builder edge function reads them and
 * returns PROPOSALS. Nothing is written until "Save all to my profile", and
 * then only what the member kept, through the same tables, storage and rules
 * as the app's own editors (Journey, Passports, Position, Media, Links).
 *
 * Rulings 2026-10-18: players and coaches; passports only fill empty slots;
 * a date of birth only when none is set and never under 18 from the chat;
 * no identity documents (the server drops photos that show one).
 */

export const CV_MAX_BYTES = 4 * 1024 * 1024
export const PHOTOS_MAX = 6
export const LINKS_MAX = 5
export const TEXT_MAX = 1500

export interface CareerDraft {
  key: string
  club_name: string
  world_club_id: string | null
  matched: boolean
  city: string | null
  country: string | null
  league: string | null
  role: string | null
  start_date: string | null
  end_date: string | null
  current: boolean
  years: string
}
export interface PassportDraft { country_id: number; name: string; code: string; flag: string | null }
export interface VideoDraft { url: string; provider: 'youtube' | 'vimeo'; title: string; thumbnail_url: string | null }
export interface SocialDraft { platform: string; url: string }
export interface PhotoCheck { index: number; ok: boolean }

export interface ProfileDraft {
  career: CareerDraft[]
  passports: PassportDraft[]
  date_of_birth: string | null
  dob_note: 'already_set' | 'under_18' | null
  position: string | null
  secondary_position: string | null
  videos: VideoDraft[]
  socials: SocialDraft[]
  photos: PhotoCheck[]
}

/** What the member attached in the composer (kept locally until Save all). */
export interface BuilderAttachments {
  cv: File | null
  photos: File[]
  links: string[]
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"')]+|(?:youtu\.be|youtube\.com|vimeo\.com|instagram\.com|tiktok\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com)\/[^\s<>"')]+)/gi

/** Links typed or pasted into the message, so people don't need the "+" for them. */
export function linksInText(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))].slice(0, LINKS_MAX)
}

/** A refused file, in plain words — or null when it's fine. */
export function cvProblem(file: File): string | null {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return 'Please attach your CV as a PDF.'
  if (file.size > CV_MAX_BYTES) return 'That PDF is over 4 MB. Try a smaller export of your CV.'
  return null
}

export function photoProblem(file: File): string | null {
  const check = validateImage(file, { maxFileSizeMB: 10 })
  return check.valid ? null : (check.error ?? 'Please use a JPG or PNG photo up to 10 MB.')
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** A small copy of a photo for the identity-document check (the full photo stays on the device until Save all). */
export async function photoThumb(file: File, max = 640): Promise<{ base64: string; media_type: 'image/jpeg' | 'image/png' }> {
  const small = await optimizeImage(file, { maxWidth: max, maxHeight: max, quality: 0.7, maxSizeMB: 0.35 })
  return { base64: await fileToBase64(small), media_type: small.type === 'image/png' ? 'image/png' : 'image/jpeg' }
}

export type BuilderResult =
  | { ok: true; draft: ProfileDraft; steps: string[] }
  | { ok: false; reason: 'limit' | 'unavailable' | 'cv_too_large' | 'nothing' | 'error' }

/** Ask Hockia AI to read what the member sent. */
export async function readForProfile(text: string, att: BuilderAttachments): Promise<BuilderResult> {
  try {
    const links = [...new Set([...att.links, ...linksInText(text)])].slice(0, LINKS_MAX)
    const cv = att.cv ? { base64: await fileToBase64(att.cv), name: att.cv.name } : null
    const photos = await Promise.all(att.photos.slice(0, PHOTOS_MAX).map(async (f, index) => ({ index, ...(await photoThumb(f)) })))
    const { data, error } = await supabase.functions.invoke('profile-builder', { body: { text: text.trim().slice(0, TEXT_MAX), links, cv, photos } })
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status
      return { ok: false, reason: status === 413 ? 'cv_too_large' : status === 400 ? 'nothing' : 'error' }
    }
    const res = data as { draft?: ProfileDraft | null; steps?: string[]; reason?: string } | null
    if (!res?.draft) return { ok: false, reason: res?.reason === 'limit' ? 'limit' : 'unavailable' }
    return { ok: true, draft: res.draft, steps: res.steps ?? [] }
  } catch (err) {
    logger.error('[profileBuilder] read failed', err)
    return { ok: false, reason: 'error' }
  }
}

export function builderErrorCopy(reason: Exclude<BuilderResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'limit': return 'You’ve used today’s profile reads. Everything else in Hockia works as usual — try again tomorrow.'
    case 'cv_too_large': return 'That CV is too large for me. Try a PDF under 4 MB.'
    case 'nothing': return 'Write a few lines about your clubs and seasons, or attach your CV, photos or links.'
    default: return 'Oops, I lost the signal for a second. Your message is safe — tap to try again.'
  }
}

/** Items in the review card (photos only count the ones that passed the check). */
export function draftItemCount(d: ProfileDraft, keptPhotos: number): number {
  return d.career.length + d.passports.length + (d.date_of_birth ? 1 : 0) + (d.position ? 1 : 0) + (d.secondary_position ? 1 : 0) + d.videos.slice(0, 1).length + d.socials.length + keptPhotos
}

export interface SaveOutcome { saved: number; failed: string[] }

/**
 * Save what the member kept. Each part is independent: one failing doesn't
 * stop the others, and the outcome says which failed. Re-checks the profile
 * first so the "only fill what's empty" rule holds even if it changed while
 * the card was open.
 */
export async function saveProfileDraft(userId: string, d: ProfileDraft, photos: File[]): Promise<SaveOutcome> {
  let saved = 0
  const failed: string[] = []
  const { data: now } = await supabase
    .from('profiles')
    .select('nationality_country_id, nationality2_country_id, position, secondary_position, date_of_birth, highlight_video_url, social_links')
    .eq('id', userId)
    .maybeSingle()
  const p = (now ?? {}) as { nationality_country_id?: number | null; nationality2_country_id?: number | null; position?: string | null; secondary_position?: string | null; date_of_birth?: string | null; highlight_video_url?: string | null; social_links?: Record<string, string> | null }

  // Career → career_history (same shape as the Journey editor).
  if (d.career.length) {
    try {
      const { data: rows } = await supabase.from('career_history').select('display_order').eq('user_id', userId)
      let order = Math.max(-1, ...((rows ?? []) as { display_order: number }[]).map((r) => r.display_order ?? 0))
      const payload = d.career.map((c) => ({
        user_id: userId,
        club_name: c.club_name,
        position_role: c.role ?? '',
        division_league: c.league ?? '',
        years: c.years,
        highlights: [] as string[],
        entry_type: 'club' as const,
        location_city: c.city,
        location_country: c.country,
        start_date: c.start_date,
        end_date: c.current ? null : c.end_date,
        world_club_id: c.world_club_id,
        display_order: ++order,
      }))
      const { error } = await supabase.from('career_history').insert(payload as never)
      if (error) throw error
      saved += payload.length
    } catch (err) { logger.error('[profileBuilder] career', err); failed.push('career') }
  }

  // Profile fields — only the empty ones.
  const patch: Record<string, unknown> = {}
  const free = [p.nationality_country_id ?? null, p.nationality2_country_id ?? null]
  const owned = free.filter((x): x is number => typeof x === 'number')
  const add = d.passports.map((x) => x.country_id).filter((id) => !owned.includes(id))
  let addedPassports = 0
  if (free[0] == null && add.length) { patch.nationality_country_id = add.shift(); addedPassports += 1 }
  if (free[1] == null && add.length) { patch.nationality2_country_id = add.shift(); addedPassports += 1 }
  // The legacy nationality text follows the first passport, as in the Passports editor.
  if (patch.nationality_country_id) {
    const { data: c } = await supabase.from('countries').select('nationality_name').eq('id', patch.nationality_country_id as number).maybeSingle()
    if ((c as { nationality_name?: string | null } | null)?.nationality_name) patch.nationality = (c as { nationality_name: string }).nationality_name
  }
  if (d.position && !p.position) patch.position = d.position
  if (d.secondary_position && !p.secondary_position && d.secondary_position !== (patch.position ?? p.position)) patch.secondary_position = d.secondary_position
  const video = d.videos[0]
  if (video && !p.highlight_video_url) patch.highlight_video_url = video.url
  const social = { ...(p.social_links ?? {}) }
  let addedSocials = 0
  for (const s of d.socials) if (!social[s.platform]) { social[s.platform] = s.url; addedSocials += 1 }
  if (addedSocials) patch.social_links = social
  if (Object.keys(patch).length) {
    try {
      const { error } = await supabase.from('profiles').update(patch as never).eq('id', userId)
      if (error) throw error
      saved += addedPassports + (patch.position ? 1 : 0) + (patch.secondary_position ? 1 : 0) + (patch.highlight_video_url ? 1 : 0) + addedSocials
    } catch (err) { logger.error('[profileBuilder] profile', err); failed.push('profile') }
  }

  // Date of birth — only when none is set; the server never proposes an under-18 date.
  if (d.date_of_birth && !p.date_of_birth) {
    try {
      const { error } = await supabase.rpc('declare_date_of_birth', { p_dob: d.date_of_birth })
      if (error) throw error
      saved += 1
    } catch (err) { logger.error('[profileBuilder] dob', err); failed.push('date of birth') }
  }

  // Photos → gallery (same bucket, path, optimisation and order as Manage media).
  if (photos.length) {
    try {
      const { data: rows } = await supabase.from('gallery_photos').select('order_index').eq('user_id', userId)
      const top = Math.max(-1, ...((rows ?? []) as { order_index: number }[]).map((r) => r.order_index ?? 0))
      const base = top + photos.length
      for (const [i, file] of photos.entries()) {
        const optimized = await optimizeImage(file, { maxWidth: 1200, maxHeight: 1200, maxSizeMB: 1, quality: 0.85 })
        const ext = optimized.type === 'image/png' ? 'png' : 'jpg'
        const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: up } = await supabase.storage.from('gallery').upload(path, optimized, { cacheControl: '31536000' })
        if (up) throw up
        const url = supabase.storage.from('gallery').getPublicUrl(path).data.publicUrl
        const { error } = await supabase.from('gallery_photos').insert({ user_id: userId, photo_url: url, file_name: file.name, file_size: optimized.size, order_index: base - i } as never)
        if (error) throw error
        saved += 1
      }
    } catch (err) { logger.error('[profileBuilder] photos', err); failed.push('photos') }
  }

  clearCoverPhotoCache(userId)
  clearProfileScrollCache(userId)
  await invalidateProfile({ userId, reason: 'hockia-ai-profile-builder' })
  return { saved, failed }
}

export interface MissingItem { key: string; title: string; detail: string }

/** What's still missing after saving — a real checklist from the profile, never a score. */
export async function stillMissing(userId: string, role: string | null | undefined): Promise<MissingItem[]> {
  const [{ data: p }, { count: career }] = await Promise.all([
    supabase.from('profiles').select('position, highlight_video_url, avatar_url, nationality_country_id').eq('id', userId).maybeSingle(),
    supabase.from('career_history').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  const q = (p ?? {}) as { position?: string | null; highlight_video_url?: string | null; avatar_url?: string | null; nationality_country_id?: number | null }
  const out: MissingItem[] = []
  if (role === 'player' && !q.position) out.push({ key: 'position', title: 'Your position and best side', detail: 'One line is enough — e.g. “left back, strong on the reverse”' })
  if (!career) out.push({ key: 'career', title: 'Your clubs and seasons', detail: 'Write them in your own words, or attach your CV' })
  if (role === 'player' && !q.highlight_video_url) out.push({ key: 'video', title: 'A highlights video', detail: 'Paste a YouTube or Vimeo link' })
  if (!q.avatar_url) out.push({ key: 'photo', title: 'A profile photo', detail: 'Add it from Edit profile' })
  if (!q.nationality_country_id) out.push({ key: 'passport', title: 'Your passports', detail: 'Just the countries — never a document' })
  return out.slice(0, 3)
}
