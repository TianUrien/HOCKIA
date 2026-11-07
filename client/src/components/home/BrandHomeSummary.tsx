import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useCountryNames } from '@/hooks/useCountryNames'
import { agoLine, fetchBrandResults, nextStep } from '@/lib/brandResults'

/**
 * A brand opens Home on its own business first (founder ruling 2026-11-07):
 * who is waiting for a reply, the last 30 days, the one next step and the
 * size of its market, with See results. The community feed stays below.
 */
export function BrandHomeSummary() {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const names = useCountryNames()
  const q = useQuery({ queryKey: ['brand-results', 30], queryFn: () => fetchBrandResults(30), enabled: role === 'brand', staleTime: 60_000 })
  if (role !== 'brand' || !q.data) return null
  const r = q.data
  const step = nextStep(r, (id) => names([id])[0] ?? null)

  return (
    <section className="mx-4 mt-3 space-y-2" aria-label="Your brand this month" data-testid="brand-home-summary">
      {r.waiting.count > 0 ? (
        <button type="button" onClick={() => navigate('/messages')} className="flex w-full items-center gap-3 rounded-[20px] bg-status-warning-soft p-4 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-status-warning">{r.waiting.count} {r.waiting.count === 1 ? 'person is' : 'people are'} waiting for your reply</span>
            <span className="block text-row text-status-warning/90">The oldest wrote {agoLine(r.waiting.oldest_at)}</span>
          </span>
          <span className="text-row font-semibold text-status-warning">Reply</span>
        </button>
      ) : null}
      <div className="rounded-[20px] border border-line bg-white p-4">
        <button type="button" onClick={() => navigate('/dashboard/results')} className="flex w-full items-center justify-between text-left" data-testid="brand-home-results">
          <span>
            <span className="block text-body font-semibold text-ink-1">Your offers, last 30 days</span>
            <span className="block text-row text-ink-2">
              {r.market_total != null ? `${r.market_total} members live where you sell` : 'See who you could reach'}
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" aria-hidden="true" />
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { v: r.totals.shown, l: 'Shown to' },
            { v: r.totals.store_visits, l: 'To your store' },
            { v: r.totals.contacted, l: 'Contacted' },
          ].map((t) => (
            <span key={t.l} className="rounded-[14px] bg-surface-subtle px-3 py-2.5">
              <span className="block text-title tabular-nums text-ink-1">{t.v}</span>
              <span className="block text-secondary text-ink-2">{t.l}</span>
            </span>
          ))}
        </div>
        {step ? (
          <div className="mt-3 rounded-[14px] bg-brand-soft p-3">
            <p className="text-row text-brand-primary">{step.text}</p>
            <button type="button" onClick={() => navigate(step.to)} className="mt-2 text-row font-semibold text-brand-primary">{step.action} ›</button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
