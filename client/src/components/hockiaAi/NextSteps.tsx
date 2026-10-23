import { useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { logger } from '@/lib/logger'
import { hapticSuccess } from '@/lib/haptics'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { recordAiAction } from '@/lib/aiChats'
import { cn } from '@/lib/utils'
import {
  BIO_MAX, classifyProfileLink, draftBio, saveBio, saveProfileLink, setAvatarFromFile, setAvatarFromUrl,
  type BioDraft, type BioFocus, type NextStep, type ProfileFacts, type StepKey,
} from '@/lib/nextSteps'
import type { SocialPlatform } from '@/lib/socialLinks'
import { ChoiceCard, type Choice } from './ChoiceCard'
import { MascotAvatar, type MascotState } from './mascot'

/** The plan as a choice card: the most useful step recommended, "Other" asks anything. */
export function NextStepPlan({ steps, question, onPick, onOther, onSkip }: { steps: NextStep[]; question: string; onPick: (key: StepKey) => void; onOther?: (text: string) => void; onSkip?: () => void }) {
  const choices: Choice<StepKey>[] = steps.slice(0, 3).map((s, i) => ({ value: s.key, label: s.label, description: s.description, recommended: i === 0 }))
  return <ChoiceCard question={question} choices={choices} onPick={(c) => onPick(c.value)} onOther={onOther} otherPlaceholder="Ask for something else…" onSkip={onSkip} testId="ai-next-step" />
}

function AiLine({ children, state = 'calm' }: { children: React.ReactNode; state?: MascotState }) {
  return (
    <div className="flex items-start gap-2.5">
      <MascotAvatar state={state} size={36} ring />
      <p className="min-w-0 flex-1 pt-2 text-[16px] leading-[22px] text-ink-1">{children}</p>
    </div>
  )
}

interface Props {
  step: StepKey
  facts: ProfileFacts | null
  steps: NextStep[]
  onStep: (key: StepKey) => void
  onAsk: (text: string) => void
  onClose: () => void
}

/**
 * One next step done with the member (founder, 2026-10-18): a profile photo, the
 * bio or a link. Hockia AI proposes, asks with ready-made options, and saves
 * only on the member's tap; then it recommends what to do next.
 */
export function NextSteps({ step, facts, steps, onStep, onAsk, onClose }: Props) {
  const [done, setDone] = useState<string | null>(null)
  const remaining = steps.filter((s) => s.key !== step)

  const finish = (what: string, title: string, summary: string) => {
    void hapticSuccess()
    setDone(what)
    void recordAiAction({ kind: 'profile', title, summary, link: '/dashboard/profile' })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" data-testid="ai-steps" data-step={step}>
      <div className="flex flex-col gap-4 pb-6 pt-1">
        {done ? (
          <>
            <div className="flex items-center gap-2.5 rounded-[18px] bg-positive-soft p-3" data-testid="ai-step-done">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-positive text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>
              <span className="text-[15px] font-semibold text-ink-1">{done}</span>
            </div>
            {remaining.length ? (
              <>
                <AiLine state="idea">Nice. Here’s what I’d do next.</AiLine>
                <NextStepPlan steps={remaining} question="What next?" onPick={onStep} onOther={onAsk} onSkip={onClose} />
              </>
            ) : (
              <>
                <AiLine state="active">Your profile has the basics clubs look for.</AiLine>
                <ChoiceCard
                  question="Want me to look for roles now?"
                  choices={[
                    { value: 'roles', label: 'Find roles that fit me', description: 'Open roles for your position and category', recommended: true },
                    { value: 'later', label: 'Not now', description: 'Close Hockia AI' },
                  ]}
                  onPick={(c) => (c.value === 'roles' ? onAsk('Open roles for me') : onClose())}
                  onOther={onAsk}
                  testId="ai-after-steps"
                />
              </>
            )}
          </>
        ) : step === 'photo' ? (
          <PhotoStep facts={facts} onDone={() => finish('Profile photo added', 'Added a profile photo', 'Action · Profile photo')} />
        ) : step === 'bio' ? (
          <BioStep facts={facts} onDone={() => finish('Bio saved to your profile', facts?.bio ? 'Improved my bio' : 'Wrote my bio', 'Action · Bio')} />
        ) : (
          <LinksStep facts={facts} preset={step === 'video' ? 'video' : null} onDone={(label) => finish(`${label} added to your profile`, `Added my ${label}`, 'Action · Link')} />
        )}
      </div>
    </div>
  )
}

// ── Photo ──────────────────────────────────────────────────────────────────

type PhotoPick = { kind: 'gallery'; url: string } | { kind: 'file'; file: File; preview: string }

function PhotoStep({ facts, onDone }: { facts: ProfileFacts | null; onDone: () => void }) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [pick, setPick] = useState<PhotoPick | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const gallery = facts?.galleryPhotos ?? []

  const choose = async () => {
    setError(null)
    if (isNativePlatform()) {
      try {
        const r = await pickImageNative('prompt', { crop: false })
        if (r) setPick({ kind: 'file', file: r.file, preview: URL.createObjectURL(r.file) })
      } catch (err) {
        logger.warn('[NextSteps] native picker', err)
        setError('I couldn’t open your photos. Check the app’s photo permission.')
      }
      return
    }
    input.current?.click()
  }

  const save = async () => {
    if (!userId || !pick) return
    setSaving(true); setError(null)
    try {
      if (pick.kind === 'gallery') await setAvatarFromUrl(userId, pick.url)
      else await setAvatarFromFile(userId, pick.file)
      trackDbEvent('hockia_ai_next_step', 'profile', userId, { step: 'photo', source: pick.kind })
      onDone()
    } catch (err) {
      logger.warn('[NextSteps] photo save', err)
      setError('That photo didn’t upload. Try a JPG or PNG under 10 MB.')
      setSaving(false)
    }
  }

  return (
    <>
      <AiLine>{gallery.length ? 'Clubs look at the photo first. One of yours could work, or upload a new one: face visible, good light, just you.' : 'Clubs look at the photo first. Pick one where your face is visible, in good light, just you.'}</AiLine>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPick({ kind: 'file', file: f, preview: URL.createObjectURL(f) }); e.target.value = '' }} data-testid="ai-photo-input" />
      {pick ? (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border border-line bg-white p-4" data-testid="ai-photo-preview">
          <img src={pick.kind === 'gallery' ? pick.url : pick.preview} alt="Your new profile photo" className="h-40 w-40 rounded-full object-cover" />
          <p className="text-[13px] text-ink-2">This is how clubs will see you.</p>
          <div className="flex w-full gap-2">
            <button type="button" onClick={() => setPick(null)} disabled={saving} className="flex-1 rounded-full border border-line py-2.5 text-[15px] font-semibold text-ink-1">Choose another</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary py-2.5 text-[15px] font-semibold text-white" data-testid="ai-photo-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Set as profile photo
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-[18px] border border-line bg-white p-3">
          {gallery.length > 0 && (
            <>
              <p className="px-1 pb-2 text-[13px] font-semibold text-ink-2">From your photos</p>
              <div className="grid grid-cols-3 gap-2" data-testid="ai-photo-gallery">
                {gallery.map((g) => (
                  <button key={g.id} type="button" onClick={() => setPick({ kind: 'gallery', url: g.url })} className="aspect-square overflow-hidden rounded-[12px] bg-surface-subtle" aria-label="Use this photo">
                    <img src={g.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={() => void choose()} className={cn('flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[15px] font-semibold', gallery.length ? 'mt-3 border border-line text-ink-1' : 'bg-hockia-primary text-white')} data-testid="ai-photo-upload">
            <ImagePlus className="h-5 w-5" strokeWidth={1.9} /> Upload a new photo
          </button>
        </div>
      )}
      {error && <p className="text-secondary text-status-danger" role="alert">{error}</p>}
    </>
  )
}

// ── Bio ────────────────────────────────────────────────────────────────────

function BioStep({ facts, onDone }: { facts: ProfileFacts | null; onDone: () => void }) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [focus, setFocus] = useState<BioFocus | 'other' | null>(null)
  const [drafts, setDrafts] = useState<BioDraft[] | null>(null)
  const [reason, setReason] = useState<'limit' | 'unavailable' | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const coach = facts?.role === 'coach'
  const draftsRef = useRef<HTMLDivElement>(null)
  // Drafts arrive below the question: bring them into view.
  useEffect(() => { if (drafts || reason) draftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [drafts, reason, chosen])

  const write = async (f: BioFocus, note?: string) => {
    setFocus(f === 'custom' ? 'other' : f); setDrafts(null); setReason(null); setChosen(null)
    const r = await draftBio(f, note)
    if (r.drafts.length) { setDrafts(r.drafts); return }
    setReason(r.reason ?? 'unavailable')
  }
  const again = () => { setFocus(null); setDrafts(null); setReason(null); setChosen(null) }
  const save = async () => {
    if (!userId || !text.trim()) return
    setSaving(true); setError(null)
    try {
      await saveBio(userId, text)
      trackDbEvent('hockia_ai_next_step', 'profile', userId, { step: 'bio', edited: drafts?.[chosen ?? 0]?.bio !== text.trim() })
      onDone()
    } catch (err) {
      logger.warn('[NextSteps] bio save', err)
      setError('I couldn’t save your bio. Try again in a moment.')
      setSaving(false)
    }
  }

  return (
    <>
      <AiLine>{facts?.bio ? 'I’ll write a fuller bio from your profile and keep what’s true in yours.' : 'I’ll write your bio from what’s on your profile. Nothing made up.'}</AiLine>
      <ChoiceCard
        question="What should your bio lead with?"
        choices={[
          { value: 'experience' as BioFocus, label: 'My clubs and experience', description: 'Clubs, leagues and seasons first', recommended: true },
          { value: 'next' as BioFocus, label: 'What I’m looking for next', description: 'The move you want, backed by your experience' },
          { value: 'style' as BioFocus, label: coach ? 'How I coach' : 'How I play', description: coach ? 'Your coaching focus first' : 'Your position and strengths first' },
        ]}
        onPick={(c) => void write(c.value)}
        onOther={(t) => void write('custom', t)}
        otherPlaceholder="e.g. “mention I speak Spanish and want to play in Europe”"
        picked={focus}
        testId="ai-bio-focus"
      />
      <div ref={draftsRef} className="scroll-mt-2" />
      {focus && !drafts && !reason && (
        <div className="flex items-center gap-2 text-[15px] font-semibold text-brand-primary" role="status" data-testid="ai-bio-writing"><Loader2 className="h-4 w-4 animate-spin" /> Writing two versions…</div>
      )}
      {reason && (
        <p className="text-[15px] leading-[22px] text-ink-2" role="alert" data-testid="ai-bio-unavailable">
          {reason === 'limit' ? 'You’ve used today’s bio drafts. Try again tomorrow, or write it yourself in Edit profile.' : 'I couldn’t write it just now.'}{' '}
          {reason !== 'limit' && <button type="button" onClick={again} className="font-semibold text-brand-primary">Try again</button>}
        </p>
      )}
      {drafts && chosen === null && (
        <div className="flex flex-col gap-2.5" data-testid="ai-bio-drafts">
          <p className="text-[15px] font-semibold text-ink-1">Pick one. You can edit it before saving.</p>
          {drafts.map((d, i) => (
            <button key={i} type="button" onClick={() => { setChosen(i); setText(d.bio) }} className={cn('rounded-[18px] border p-3.5 text-left', i === 0 ? 'border-brand-primary bg-brand-soft' : 'border-line bg-white')} data-testid="ai-bio-draft">
              <span className="flex items-center gap-2">
                <span className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">{d.angle}</span>
                {i === 0 && <span className="rounded-full bg-brand-primary px-2 py-[1px] text-[11px] font-semibold leading-4 text-white">Recommended</span>}
              </span>
              <span className="mt-1.5 block text-[15px] leading-[21px] text-ink-1">{d.bio}</span>
            </button>
          ))}
          <button type="button" onClick={again} className="self-start text-secondary font-semibold text-brand-primary">Try another angle</button>
        </div>
      )}
      {drafts && chosen !== null && (
        <div className="rounded-[18px] border border-line bg-white p-3" data-testid="ai-bio-edit">
          <label className="block">
            <span className="text-[13px] font-semibold text-ink-2">Your bio</span>
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, BIO_MAX * 2))} rows={6} className="mt-1.5 block w-full resize-y rounded-[12px] bg-surface-subtle p-3 text-[15px] leading-[21px] text-ink-1 focus:outline-none" data-testid="ai-bio-text" />
          </label>
          {facts?.bio && <p className="mt-2 text-caption text-ink-3">This replaces your current bio.</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setChosen(null)} disabled={saving} className="flex-1 rounded-full border border-line py-2.5 text-[15px] font-semibold text-ink-1">Back</button>
            <button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary py-2.5 text-[15px] font-semibold text-white" data-testid="ai-bio-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save to my profile
            </button>
          </div>
          {error && <p className="mt-2 text-secondary text-status-danger" role="alert">{error}</p>}
        </div>
      )}
    </>
  )
}

// ── Links ──────────────────────────────────────────────────────────────────

type LinkTarget = 'video' | SocialPlatform | 'any'
const LINK_LABEL: Record<LinkTarget, string> = { video: 'highlights video', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', twitter: 'X', facebook: 'Facebook', any: 'link' }
const LINK_PLACEHOLDER: Record<LinkTarget, string> = { video: 'https://youtube.com/watch?v=…', instagram: 'https://instagram.com/yourname', tiktok: 'https://tiktok.com/@yourname', linkedin: 'https://linkedin.com/in/yourname', twitter: 'https://x.com/yourname', facebook: 'https://facebook.com/yourname', any: 'Paste a link' }

function LinksStep({ facts, preset, onDone }: { facts: ProfileFacts | null; preset: 'video' | null; onDone: (label: string) => void }) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [target, setTarget] = useState<LinkTarget | null>(preset)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const player = facts?.role === 'player'
  const has = (k: string) => Boolean(facts?.social_links?.[k]?.trim())
  const needsVideo = player && !facts?.highlight_video_url

  const choices: Choice<LinkTarget>[] = [
    ...(needsVideo ? [{ value: 'video' as LinkTarget, label: 'Highlights video', description: 'YouTube or Vimeo: clubs watch this first' }] : []),
    ...(!has('instagram') ? [{ value: 'instagram' as LinkTarget, label: 'Instagram', description: 'Where most players and clubs follow each other' }] : []),
    ...(!has('tiktok') ? [{ value: 'tiktok' as LinkTarget, label: 'TikTok', description: 'Short clips of your game' }] : []),
    ...(!has('linkedin') ? [{ value: 'linkedin' as LinkTarget, label: 'LinkedIn', description: 'Useful for coaching and study plans' }] : []),
  ].slice(0, 3).map((c, i) => ({ ...c, recommended: i === 0 }))

  const save = async () => {
    if (!userId || !target) return
    const link = classifyProfileLink(url)
    if (link.kind === 'invalid') { setError('That doesn’t look like a profile or video link. Paste the full address.'); return }
    if (target === 'video' && link.kind !== 'video') { setError('That isn’t a YouTube or Vimeo link.'); return }
    if (target !== 'video' && target !== 'any' && (link.kind !== 'social' || link.platform !== target)) { setError(`That isn’t ${/^[aeiou]/i.test(LINK_LABEL[target]) ? 'an' : 'a'} ${LINK_LABEL[target]} link.`); return }
    setSaving(true); setError(null)
    try {
      await saveProfileLink(userId, link)
      trackDbEvent('hockia_ai_next_step', 'profile', userId, { step: 'link', kind: link.kind === 'video' ? 'video' : link.platform })
      onDone(link.kind === 'video' ? 'Highlights video' : LINK_LABEL[link.platform])
    } catch (err) {
      logger.warn('[NextSteps] link save', err)
      setError('I couldn’t save that link. Try again in a moment.')
      setSaving(false)
    }
  }

  return (
    <>
      <AiLine>{preset === 'video' ? 'A highlights video is the first thing clubs open. Paste a YouTube or Vimeo link.' : 'Links let clubs see more of you. Which one do you want to add?'}</AiLine>
      {!preset && (
        <ChoiceCard
          question="Which link do you want to add?"
          choices={choices}
          onPick={(c) => { setTarget(c.value); setUrl(''); setError(null) }}
          onOther={(t) => { setTarget('any'); setUrl(t); setError(null) }}
          otherPlaceholder="Paste any profile or video link"
          picked={target}
          testId="ai-link-kind"
        />
      )}
      {target && (
        <div className="rounded-[18px] border border-line bg-white p-3" data-testid="ai-link-form">
          <label className="block">
            <span className="text-[13px] font-semibold text-ink-2">Your {LINK_LABEL[target]}</span>
            <input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => { setUrl(e.target.value); setError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} placeholder={LINK_PLACEHOLDER[target]} className="mt-1.5 block w-full rounded-[12px] bg-surface-subtle px-3 py-2.5 text-[15px] text-ink-1 placeholder:text-ink-3 focus:outline-none" data-testid="ai-link-input" />
          </label>
          {error && <p className="mt-2 text-secondary text-status-danger" role="alert">{error}</p>}
          <button type="button" onClick={() => void save()} disabled={saving || !url.trim()} className={cn('mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-hockia-primary py-2.5 text-[15px] font-semibold text-white', (!url.trim() || saving) && 'opacity-50')} data-testid="ai-link-save">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add to my profile
          </button>
        </div>
      )}
    </>
  )
}
