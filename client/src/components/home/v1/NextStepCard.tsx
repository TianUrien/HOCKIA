import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, LineChart, User } from 'lucide-react'
import { getImageUrl } from '@/lib/imageUrl'
import { hapticLight } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { SquircleBox } from './primitives'
import { FaceCircle } from './FaceCircle'
import { useNextStep, type NextStep, type NextStepVisual } from './useNextStep'
import { HOME_V1_MODULES, recordModuleImpression, recordNextStepImpression, trackModuleClick, trackNextStepAction, useImpressionOnce } from '@/lib/homeInstrumentation'
import { navState } from '@/lib/navSource'

/**
 * Next step (Figma 60:140 / H5 64:326): ONE purple card, the highest-priority
 * Pulse action, "1 of N" dots under it — swipe for the next. The CTA hugs its
 * label (min 58, 44 tall); copy is one line each and truncates before it.
 * Announces as one button with its CTA (spec Accessibility).
 */
export function NextStepCard({ onCompose }: { onCompose: () => void }) {
  const { steps, loading, run, markDone } = useNextStep()
  const navigate = useNavigate()
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  // Motion 95:1012 §3: the resolved card leaves (−24 pt, 150 ms), the next enters (+24 pt, 250 ms).
  const [leaving, setLeaving] = useState<string | null>(null)
  const [entering, setEntering] = useState<string | null>(null)
  const impressionRef = useImpressionOnce(() => recordModuleImpression(HOME_V1_MODULES.nextStep.id, HOME_V1_MODULES.nextStep.position))

  // Which step was actually on screen (gap 8: the card replaced Pulse items).
  // Only once the list has settled — while loading, the first slot changes as each source resolves.
  const activeKey = !loading && steps.length > 0 ? steps[Math.min(index, steps.length - 1)].key : null
  useEffect(() => { if (activeKey) recordNextStepImpression(activeKey) }, [activeKey])

  if (loading && steps.length <= 1) return <NextStepSkeleton />
  if (steps.length === 0) return null
  const active = Math.min(index, steps.length - 1)

  const act = async (step: NextStep) => {
    void hapticLight()
    if (step.action === 'compose') {
      trackNextStepAction(step.key, 'compose', 'home_v1')
      trackModuleClick(HOME_V1_MODULES.nextStep.id, HOME_V1_MODULES.nextStep.position, 'compose')
      onCompose()
      return
    }
    if (step.action === 'confirm_availability') {
      setBusy(step.key)
      const i = steps.indexOf(step)
      const ok = await run(step)
      setBusy(null)
      if (ok) {
        setLeaving(step.key)
        window.setTimeout(() => {
          setLeaving(null)
          markDone(step.key)
          // The next card takes this slot; the last one hands over to "Your week".
          setEntering(steps[i + 1]?.key ?? 'week')
        }, 150)
      }
      return
    }
    if (step.to) {
      trackNextStepAction(step.key, 'open', 'home_v1')
      trackModuleClick(HOME_V1_MODULES.nextStep.id, HOME_V1_MODULES.nextStep.position, step.to)
      navigate(step.to, navState('home_next_step'))
    }
  }

  const onScroll = () => {
    const el = trackRef.current
    if (el) setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
  }

  return (
    <section ref={impressionRef} aria-label="Next step" className="flex flex-col items-center gap-2 px-4 pb-4 pt-2" data-testid="home-next-step">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {steps.map((step, i) => (
          <div key={step.key} className="w-full shrink-0 snap-center" aria-hidden={i !== active || undefined} onAnimationEnd={() => entering === step.key && setEntering(null)}>
            <SquircleBox
              className={cn('bg-gradient-to-r from-hockia-primary to-[#3e1696]', leaving === step.key && 'hockia-step-out', entering === step.key && 'hockia-step-in')}
            >
              <button
                type="button"
                onClick={() => void act(step)}
                disabled={busy === step.key}
                aria-label={`${step.title}${step.subtitle ? `, ${step.subtitle}` : ''}. ${step.cta}`}
                className="flex w-full items-center gap-3 py-4 pl-3.5 pr-3 text-left transition-transform duration-300 ease-[cubic-bezier(0.34,1.36,0.64,1)] active:scale-[0.97]"
              >
                <Visual visual={step.visual} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-white">{step.title}</span>
                  {step.subtitle && <span className="block truncate text-secondary text-white/75">{step.subtitle}</span>}
                </span>
                <span className="flex h-11 min-w-[58px] shrink-0 items-center justify-center rounded-full bg-white px-4 text-[14px] font-semibold text-hockia-primary">
                  {busy === step.key ? '…' : step.cta}
                </span>
              </button>
            </SquircleBox>
          </div>
        ))}
      </div>
      {steps.length > 1 && (
        <div className="flex items-center gap-[5px]" aria-label={`${active + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s.key} className={cn('h-1.5 rounded-[3px] transition-[width,background-color] duration-[250ms] ease-[cubic-bezier(.2,0,0,1)]', i === active ? 'w-4 bg-hockia-primary' : 'w-1.5 bg-ink-4')} />
          ))}
        </div>
      )}
    </section>
  )
}

const ICONS = { camera: Camera, check: Check, chart: LineChart, stick: Check, user: User }

function Visual({ visual }: { visual: NextStepVisual }) {
  if (visual.kind === 'icon') {
    const Icon = ICONS[visual.icon]
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-dashed border-white/50 bg-white/15">
        <Icon className="h-6 w-6 text-white" strokeWidth={1.8} aria-hidden="true" />
      </span>
    )
  }
  if (visual.kind === 'faces') {
    const people = visual.people.slice(0, 3)
    return (
      <span className="relative h-14 shrink-0" style={{ width: 40 + (people.length - 1) * 20 }} aria-hidden="true">
        {people.map((p, i) => (
          <span key={i} className="absolute top-2" style={{ left: i * 20 }}>
            <FaceCircle url={p.url} name={p.name} role={p.role} size="avatar-sm" initialsClassName="text-[13px]" className="h-10 w-10 ring-2 ring-white" />
          </span>
        ))}
      </span>
    )
  }
  const urls = visual.urls.slice(0, 3)
  return (
    <span className="relative h-14 shrink-0" style={{ width: 40 + (urls.length - 1) * 20 }} aria-hidden="true">
      {urls.map((u, i) => (
        <span key={i} className="absolute top-2 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white p-1 ring-2 ring-white" style={{ left: i * 20 }}>
          {u ? <img src={getImageUrl(u, 'avatar-sm') ?? u} alt="" className="h-full w-full object-contain" /> : <span className="h-full w-full bg-hockia-soft" />}
        </span>
      ))}
    </span>
  )
}

export function NextStepSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-2" aria-hidden="true">
      <div className="h-[88px] w-full animate-pulse rounded-[24px] bg-surface-muted" />
      <div className="h-1.5" />
    </div>
  )
}
