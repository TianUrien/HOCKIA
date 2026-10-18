import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, Check, FileText, Image as ImageIcon, Link2, Loader2, Play, Plus, X } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { positionLabel } from '@/lib/identity'
import { cn } from '@/lib/utils'
import {
  LINKS_MAX, PHOTOS_MAX, TEXT_MAX, builderErrorCopy, cvProblem, draftItemCount, linksInText, photoProblem, readForProfile, saveProfileDraft, stillMissing,
  type BuilderAttachments, type CareerDraft, type MissingItem, type ProfileDraft,
} from '@/lib/profileBuilder'
import { MascotAvatar } from './mascot'

/**
 * "Fill my profile for me" (handoff P0–P3): the member writes their career in
 * their own words and attaches a CV, photos and links; Hockia AI reads them
 * and shows ONE review card. Every item can be removed or edited; nothing is
 * saved until "Save all to my profile". Rulings 2026-10-18 (players and
 * coaches; passports fill empty slots only; no under-18 date of birth from
 * the chat; never identity documents).
 */
type Phase = 'intro' | 'reading' | 'review' | 'saving' | 'saved' | 'error'

const SOCIAL_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', twitter: 'X', linkedin: 'LinkedIn' }
const EMPTY: BuilderAttachments = { cv: null, photos: [], links: [] }

function AssistantTurn({ children, glow = false }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-2', glow ? 'border-[#a88cfa] shadow-[0_0_6px_rgba(168,140,250,0.7)]' : 'border-[rgba(168,140,250,0.5)]')}>
        <MascotAvatar size={36} />
      </span>
      <div className="min-w-0 flex-1 pt-1">{children}</div>
    </div>
  )
}

export function ProfileBuilder({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const [phase, setPhase] = useState<Phase>('intro')
  const [text, setText] = useState('')
  const [att, setAtt] = useState<BuilderAttachments>(EMPTY)
  const [sent, setSent] = useState<{ text: string; att: BuilderAttachments } | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keptPhotos, setKeptPhotos] = useState<number[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ saved: number; failed: string[] } | null>(null)
  const [missing, setMissing] = useState<MissingItem[]>([])
  const [menu, setMenu] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const cvInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [phase, draft])
  const urls = useMemo(() => (sent?.att.photos ?? []).map((f) => URL.createObjectURL(f)), [sent])
  const trayUrls = useMemo(() => att.photos.map((f) => URL.createObjectURL(f)), [att.photos])
  useEffect(() => () => { urls.forEach(URL.revokeObjectURL) }, [urls])
  useEffect(() => () => { trayUrls.forEach(URL.revokeObjectURL) }, [trayUrls])

  const hasAttachments = Boolean(att.cv || att.photos.length || att.links.length)
  const busy = phase === 'reading' || phase === 'saving'
  const canSend = !busy && (text.trim().length > 0 || hasAttachments)

  const send = async () => {
    if (!canSend || !profile?.id) return
    const payload = { text: text.trim(), att }
    setSent(payload); setText(''); setAtt(EMPTY); setDraft(null); setError(null); setOutcome(null); setPhase('reading')
    trackDbEvent('profile_builder_read', 'profile', profile.id, { has_text: Boolean(payload.text), cv: Boolean(payload.att.cv), photos: payload.att.photos.length, links: payload.att.links.length + linksInText(payload.text).length })
    const res = await readForProfile(payload.text, payload.att)
    if (!res.ok) { setError(builderErrorCopy(res.reason)); setPhase('error'); return }
    setDraft(res.draft); setSteps(res.steps)
    setKeptPhotos(res.draft.photos.filter((x) => x.ok).map((x) => x.index))
    setPhase('review')
  }

  const retry = () => { if (!sent) return; setText(sent.text); setAtt(sent.att); setPhase('intro'); setError(null) }

  const pickCv = (f?: File) => { if (!f) return; const p = cvProblem(f); if (p) { addToast(p, 'error'); return } setAtt((a) => ({ ...a, cv: f })) }
  const pickPhotos = (files: FileList | null) => {
    const ok = [...(files ?? [])].filter((f) => { const p = photoProblem(f); if (p) addToast(p, 'error'); return !p })
    setAtt((a) => ({ ...a, photos: [...a.photos, ...ok].slice(0, PHOTOS_MAX) }))
  }
  const addLink = () => {
    const l = linkDraft.trim()
    if (!l) return
    setAtt((a) => ({ ...a, links: [...new Set([...a.links, l])].slice(0, LINKS_MAX) }))
    setLinkDraft(''); setMenu(false)
  }

  // Review-card edits.
  const removeCareer = (key: string) => setDraft((d) => d && { ...d, career: d.career.filter((c) => c.key !== key) })
  const editCareer = (key: string, patch: Partial<CareerDraft>) => setDraft((d) => d && { ...d, career: d.career.map((c) => (c.key === key ? { ...c, ...patch, ...(patch.club_name ? { world_club_id: null, matched: false } : {}) } : c)) })
  const count = draft ? draftItemCount(draft, keptPhotos.length) : 0

  const saveAll = async () => {
    if (!draft || !profile?.id || !count) return
    setPhase('saving')
    const photos = (sent?.att.photos ?? []).filter((_, i) => keptPhotos.includes(i))
    const res = await saveProfileDraft(profile.id, draft, photos)
    trackDbEvent('profile_builder_saved', 'profile', profile.id, { saved: res.saved, failed: res.failed.length })
    setOutcome(res)
    // Open profile screens reload what they show (PlayerProfileV2 listens).
    window.dispatchEvent(new Event('hockia:profile-updated'))
    setMissing(await stillMissing(profile.id, profile.role))
    setPhase('saved')
  }

  const firstName = profile?.full_name?.trim().split(/\s+/)[0]
  const playerish = profile?.role === 'coach' ? 'your coaching career' : 'your hockey career'

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-testid="profile-builder">
        <div className="flex flex-col gap-4 pb-4 pt-1">
          <AssistantTurn>
            <p className="text-[16px] leading-[22px] text-ink-1">{firstName ? `${firstName}, tell me about ${playerish}` : `Tell me about ${playerish}`} — your clubs and seasons, your passports and anything else clubs should know. Add your CV, photos or links with <span className="font-semibold">+</span>.</p>
            <p className="mt-1.5 text-caption text-ink-3">I read it and show you everything before it goes on your profile. Nothing is saved until you confirm.</p>
          </AssistantTurn>

          {sent && (
            <div className="flex flex-col items-end gap-1.5" data-testid="builder-sent">
              {(sent.att.cv || urls.length > 0 || sent.att.links.length > 0) && (
                <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                  {urls.map((u, i) => <img key={u} src={u} alt={`Photo ${i + 1}`} className="h-16 w-16 rounded-[14px] object-cover" />)}
                  {sent.att.cv && <span className="flex items-center gap-1.5 rounded-[14px] bg-brand-soft px-2.5 py-2 text-secondary text-ink-1"><FileText className="h-4 w-4 text-brand-primary" />{sent.att.cv.name}</span>}
                  {sent.att.links.map((l) => <span key={l} className="flex max-w-[240px] items-center gap-1.5 truncate rounded-[14px] bg-brand-soft px-2.5 py-2 text-secondary text-ink-1"><Link2 className="h-4 w-4 shrink-0 text-brand-primary" /><span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, '')}</span></span>)}
                </div>
              )}
              {sent.text && <p className="max-w-[300px] whitespace-pre-wrap rounded-[20px] rounded-br-[6px] bg-hockia-primary px-3.5 py-2.5 text-[16px] leading-[22px] text-white">{sent.text}</p>}
            </div>
          )}

          {phase === 'reading' && sent && (
            <AssistantTurn>
              <p className="text-secondary font-semibold text-brand-primary">Reading what you sent…</p>
              <ul className="mt-2 flex flex-col gap-1.5" data-testid="builder-reading">
                {[sent.text && 'Reading your message', sent.att.cv && 'Reading your CV', (sent.att.links.length + linksInText(sent.text).length) > 0 && 'Opening your links', sent.att.photos.length > 0 && `Checking ${sent.att.photos.length === 1 ? 'the photo' : `the ${sent.att.photos.length} photos`}`, 'Preparing a summary for you to review']
                  .filter(Boolean).map((s) => (
                    <li key={s as string} className="flex items-center gap-2 text-secondary text-ink-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-brand-primary" />{s}</li>
                  ))}
              </ul>
              <p className="mt-2 text-caption text-ink-3">Nothing is saved until you confirm.</p>
            </AssistantTurn>
          )}

          {phase === 'error' && error && (
            <AssistantTurn>
              <p className="text-[16px] leading-[22px] text-ink-1" data-testid="builder-error">{error}</p>
              <button type="button" onClick={retry} className="mt-2 flex h-10 items-center rounded-full bg-surface-subtle px-4 text-secondary font-semibold text-ink-1">Try again</button>
            </AssistantTurn>
          )}

          {draft && (phase === 'review' || phase === 'saving') && (
            <AssistantTurn>
              {steps.length > 0 && (
                <ul className="mb-2.5 flex flex-col gap-1" data-testid="builder-steps">
                  {steps.map((s) => <li key={s} className="flex items-center gap-2 text-secondary text-ink-2"><span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-positive"><Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /></span>{s}</li>)}
                </ul>
              )}
              {count === 0 ? (
                <p className="text-[16px] leading-[22px] text-ink-1" data-testid="builder-nothing">I couldn’t find anything new to add — your profile may already have it. Tell me more, or attach your CV.</p>
              ) : (
                <>
                  <p className="text-[16px] leading-[22px] text-ink-1">Here’s what I’ll add. Tap anything to fix it, or save it all.</p>
                  <div className="mt-2.5 overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_6px_18px_rgba(74,31,148,0.08)]" data-testid="builder-review">
                    <div className="bg-surface-subtle px-3 py-2.5 text-micro font-semibold uppercase tracking-[0.04em] text-brand-primary">Add to your profile · {count} {count === 1 ? 'item' : 'items'}</div>

                    {draft.career.length > 0 && (
                      <Group label="Career">
                        {draft.career.map((c) => (
                          <div key={c.key} data-testid="builder-career-row">
                            {editing === c.key ? (
                              <div className="flex flex-col gap-1.5 py-1">
                                <input value={c.club_name} onChange={(e) => editCareer(c.key, { club_name: e.target.value })} aria-label="Club" className="h-10 rounded-[10px] border border-line px-2.5 text-[15px]" />
                                <input value={c.league ?? ''} onChange={(e) => editCareer(c.key, { league: e.target.value || null })} placeholder="League (optional)" aria-label="League" className="h-10 rounded-[10px] border border-line px-2.5 text-[15px]" />
                                <input value={c.years} onChange={(e) => editCareer(c.key, { years: e.target.value })} aria-label="Years" className="h-10 rounded-[10px] border border-line px-2.5 text-[15px]" />
                                <button type="button" onClick={() => setEditing(null)} className="self-start text-secondary font-semibold text-brand-primary">Done</button>
                              </div>
                            ) : (
                              <Row onEdit={() => setEditing(c.key)} onRemove={() => removeCareer(c.key)} title={[c.club_name, c.city].filter(Boolean).join(' · ')} sub={[c.years, c.league].filter(Boolean).join(' · ')} tag={c.matched ? null : 'Check this club'} />
                            )}
                          </div>
                        ))}
                      </Group>
                    )}

                    {(draft.videos.length > 0 || keptPhotos.length > 0 || draft.photos.some((x) => !x.ok)) && (
                      <Group label="Videos & photos">
                        <div className="flex flex-wrap gap-2">
                          {draft.videos.slice(0, 1).map((v) => (
                            <div key={v.url} className="relative h-16 w-24 overflow-hidden rounded-[10px] bg-surface-muted">
                              {v.thumbnail_url && <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />}
                              <span className="absolute inset-0 m-auto flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/45"><Play className="h-3 w-3 fill-white text-white" /></span>
                              <button type="button" onClick={() => setDraft((d) => d && { ...d, videos: [] })} aria-label="Remove video" className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                          {keptPhotos.map((i) => (
                            <div key={i} className="relative h-16 w-16 overflow-hidden rounded-[10px]">
                              <img src={urls[i]} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                              <button type="button" onClick={() => setKeptPhotos((k) => k.filter((x) => x !== i))} aria-label={`Remove photo ${i + 1}`} className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white"><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                        </div>
                        <p className="text-caption text-ink-2">{[draft.videos[0] && `Highlights video · ${draft.videos[0].title}`, keptPhotos.length > 0 && `${keptPhotos.length} ${keptPhotos.length === 1 ? 'photo' : 'photos'} to your gallery`].filter(Boolean).join(' · ')}</p>
                        {draft.photos.some((x) => !x.ok) && <p className="text-caption text-ink-2" data-testid="builder-id-photo">I left out {draft.photos.filter((x) => !x.ok).length === 1 ? 'a photo that looks' : 'photos that look'} like an ID document. Passports are just the country — never a document.</p>}
                      </Group>
                    )}

                    {draft.passports.length > 0 && (
                      <Group label="Passports">
                        {draft.passports.map((x) => (
                          <Row key={x.country_id} title={`${x.flag ?? ''} ${x.name}`.trim()} sub={null} onRemove={() => setDraft((d) => d && { ...d, passports: d.passports.filter((y) => y.country_id !== x.country_id) })} />
                        ))}
                      </Group>
                    )}

                    {(draft.position || draft.secondary_position) && (
                      <Group label="Position">
                        {draft.position && <Row title={positionLabel(draft.position) ?? draft.position} sub="Main position" onRemove={() => setDraft((d) => d && { ...d, position: null })} />}
                        {draft.secondary_position && <Row title={positionLabel(draft.secondary_position) ?? draft.secondary_position} sub="Second position" onRemove={() => setDraft((d) => d && { ...d, secondary_position: null })} />}
                      </Group>
                    )}

                    {(draft.date_of_birth || draft.dob_note === 'under_18') && (
                      <Group label="Date of birth · only you see it">
                        {draft.date_of_birth
                          ? <Row title={new Date(`${draft.date_of_birth}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} sub="Clubs see your age, never the date" onRemove={() => setDraft((d) => d && { ...d, date_of_birth: null })} />
                          : <p className="text-secondary text-ink-2" data-testid="builder-under18">The date you wrote is under 18. Under-18 accounts work differently on Hockia, so I didn’t add it. If it’s right, add it from Edit profile.</p>}
                      </Group>
                    )}

                    {draft.socials.length > 0 && (
                      <Group label="Links">
                        {draft.socials.map((x) => <Row key={x.url} title={SOCIAL_LABEL[x.platform] ?? x.platform} sub={x.url.replace(/^https?:\/\/(www\.)?/, '')} onRemove={() => setDraft((d) => d && { ...d, socials: d.socials.filter((y) => y.url !== x.url) })} />)}
                      </Group>
                    )}

                    <div className="px-3 pb-3 pt-1.5">
                      <button type="button" onClick={() => void saveAll()} disabled={phase === 'saving' || count === 0} className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white disabled:opacity-60" data-testid="builder-save-all">
                        {phase === 'saving' ? 'Saving…' : 'Save all to my profile'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </AssistantTurn>
          )}

          {phase === 'saved' && outcome && (
            <>
              <div className="flex justify-end"><p className="rounded-[20px] rounded-br-[6px] bg-hockia-primary px-3.5 py-2.5 text-[16px] text-white">Save all</p></div>
              <AssistantTurn glow>
                {outcome.saved > 0 && (
                  <div className="flex items-center gap-2.5 rounded-[18px] bg-positive-soft p-3" data-testid="builder-saved">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-positive text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-ink-1">{outcome.saved} {outcome.saved === 1 ? 'item' : 'items'} added to your profile</span>
                      <button type="button" onClick={() => { onClose(); navigate('/dashboard/profile') }} className="text-secondary font-semibold text-positive">View my profile</button>
                    </span>
                  </div>
                )}
                {outcome.failed.length > 0 && <p className="mt-2 text-secondary text-status-danger" data-testid="builder-save-failed">I couldn’t save your {outcome.failed.join(', ')}. Try again in a moment — the rest is saved.</p>}
                {missing.length > 0 ? (
                  <>
                    <p className="mt-2.5 text-[16px] leading-[22px] text-ink-1">{missing.length === 1 ? 'One thing clubs often ask for is still missing:' : 'A few things clubs often ask for are still missing:'}</p>
                    <ul className="mt-2 flex flex-col gap-2" data-testid="builder-missing">
                      {missing.map((m) => (
                        <li key={m.key} className="flex items-center gap-2.5 rounded-[14px] border border-line px-3 py-2.5">
                          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-ink-4" aria-hidden="true" />
                          <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-ink-1">{m.title}</span><span className="block text-caption text-ink-2">{m.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : outcome.saved > 0 && <p className="mt-2.5 text-[16px] leading-[22px] text-ink-1">Your profile has the basics clubs look for.</p>}
              </AssistantTurn>
            </>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        {hasAttachments && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="builder-tray">
            {att.cv && <Chip label={att.cv.name} icon={<FileText className="h-3.5 w-3.5" />} onRemove={() => setAtt((a) => ({ ...a, cv: null }))} />}
            {att.photos.map((f, i) => <Chip key={`${f.name}${i}`} label={f.name} img={trayUrls[i]} onRemove={() => setAtt((a) => ({ ...a, photos: a.photos.filter((_, j) => j !== i) }))} />)}
            {att.links.map((l) => <Chip key={l} label={l.replace(/^https?:\/\/(www\.)?/, '')} icon={<Link2 className="h-3.5 w-3.5" />} onRemove={() => setAtt((a) => ({ ...a, links: a.links.filter((x) => x !== l) }))} />)}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[28px] border border-line bg-white p-1.5 shadow-[0_2px_10px_rgba(15,15,20,0.06)]">
          <button type="button" onClick={() => setMenu(true)} disabled={busy} aria-label="Attach a CV, photos or a link" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-2 disabled:opacity-40" data-testid="builder-attach">
            <Plus className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Tell Hockia AI about your career</span>
            <textarea
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Your clubs, seasons, passports…"
              className="block max-h-[140px] min-h-[40px] w-full resize-none bg-transparent py-[9px] text-[17px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:outline-none"
              data-testid="builder-composer"
            />
          </label>
          <button type="button" onClick={() => void send()} disabled={!canSend} aria-label="Send" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-primary text-white', !canSend && 'opacity-40')} data-testid="builder-send">
            <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <input ref={cvInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pickCv(e.target.files?.[0]); e.target.value = ''; setMenu(false) }} data-testid="builder-cv-input" />
      <input ref={photoInput} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => { pickPhotos(e.target.files); e.target.value = ''; setMenu(false) }} data-testid="builder-photo-input" />

      <BottomSheet open={menu} onClose={() => setMenu(false)} ariaLabel="Add to Hockia AI">
        <div className="flex flex-col gap-2 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-1" data-testid="builder-attach-menu">
          <h2 className="text-[20px] font-bold text-ink-1">Add to your message</h2>
          <MenuRow icon={<FileText className="h-5 w-5" />} title="CV (PDF)" sub="I’ll pick out your clubs and seasons" onClick={() => cvInput.current?.click()} disabled={Boolean(att.cv)} testId="builder-add-cv" />
          <MenuRow icon={<ImageIcon className="h-5 w-5" />} title="Photos" sub={`Up to ${PHOTOS_MAX}, for your gallery`} onClick={() => photoInput.current?.click()} disabled={att.photos.length >= PHOTOS_MAX} testId="builder-add-photos" />
          <div className="rounded-[16px] bg-surface-subtle p-3">
            <p className="flex items-center gap-2 text-[16px] font-semibold text-ink-1"><Link2 className="h-5 w-5 text-ink-2" /> Video or link</p>
            <p className="mt-0.5 text-caption text-ink-2">YouTube or Vimeo highlights, your Instagram, or a club or league page</p>
            <div className="mt-2 flex gap-2">
              <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLink() }} placeholder="Paste a link" inputMode="url" className="h-11 min-w-0 flex-1 rounded-[12px] border border-line bg-white px-3 text-[15px]" data-testid="builder-link-input" />
              <button type="button" onClick={addLink} disabled={!linkDraft.trim() || att.links.length >= LINKS_MAX} className="h-11 rounded-full bg-hockia-primary px-4 text-[15px] font-semibold text-white disabled:opacity-40" data-testid="builder-link-add">Add</button>
            </div>
          </div>
          <p className="px-1 text-caption text-ink-3">Never add ID documents or passport photos. For passports, just write the country.</p>
        </div>
      </BottomSheet>
    </>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t-[0.5px] border-line px-3 py-2.5">
      <p className="text-micro font-semibold uppercase tracking-[0.04em] text-ink-3">{label}</p>
      {children}
    </div>
  )
}

function Row({ title, sub, tag = null, onEdit, onRemove }: { title: string; sub: string | null; tag?: string | null; onEdit?: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onEdit} disabled={!onEdit} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold leading-[19px] text-ink-1">{title}</span>
          {tag && <span className="shrink-0 rounded-full bg-surface-muted px-2 py-[1px] text-caption font-semibold text-ink-2" data-testid="builder-check-club">{tag}</span>}
        </span>
        {sub && <span className="block truncate text-caption text-ink-2">{sub}</span>}
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-subtle"><X className="h-4 w-4" /></button>
    </div>
  )
}

function Chip({ label, icon, img, onRemove }: { label: string; icon?: React.ReactNode; img?: string; onRemove: () => void }) {
  return (
    <span className="flex max-w-[200px] items-center gap-1.5 rounded-full bg-brand-soft py-1 pl-1.5 pr-1 text-caption text-ink-1">
      {img ? <img src={img} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="pl-1 text-brand-primary">{icon}</span>}
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-white/60"><X className="h-3.5 w-3.5" /></button>
    </span>
  )
}

function MenuRow({ icon, title, sub, onClick, disabled, testId }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-[16px] bg-surface-subtle px-3 py-3 text-left disabled:opacity-40" data-testid={testId}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand-primary">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-ink-1">{title}</span><span className="block text-caption text-ink-2">{sub}</span></span>
    </button>
  )
}
