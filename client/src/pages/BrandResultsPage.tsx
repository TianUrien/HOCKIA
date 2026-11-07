import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Header from '@/components/Header'
import Avatar from '@/components/Avatar'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/lib/auth'
import { useCountryNames } from '@/hooks/useCountryNames'
import { cn } from '@/lib/utils'
import {
  RESULT_PERIODS,
  agoLine,
  changeLine,
  fetchBrandResults,
  nextStep,
  roleLabel,
  surfaceLabel,
  type BrandResults,
  type ResultPeriod,
} from '@/lib/brandResults'

const card = 'rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(15,15,20,0.06)]'
const eyebrow = 'text-caption font-semibold uppercase tracking-[0.06em] text-brand-primary'
const sectionTitle = 'mt-1 text-title text-ink-1'

/**
 * Results (Figma 08 · Brands P3 / R1, built 2026-11-07): one scroll that
 * answers, in order, who is waiting, what members did, the next step, which
 * offer works, who wants to talk, how big the market is, where the offers
 * were seen, products, and ambassadors and followers. Owner only. Every
 * breakdown hides groups under 5; nobody is identified except people who
 * wrote to the brand. The weekly "Did your change work?" chart waits until
 * offers have 4 weeks of data.
 */
export default function BrandResultsPage() {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const [days, setDays] = useState<ResultPeriod>(30)
  const names = useCountryNames()
  const countryName = (id: number) => names([id])[0] ?? null
  const q = useQuery({ queryKey: ['brand-results', days], queryFn: () => fetchBrandResults(days), enabled: role === 'brand', staleTime: 60_000 })

  if (role && role !== 'brand') return <Navigate to="/dashboard/profile" replace />
  const r = q.data

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-results">
      <Header mobileHidden />
      <DetailNavBar parent="Profile" title="Results" fallbackPath="/dashboard/profile" />
      <main className="mx-auto max-w-[720px] space-y-3 px-4 pb-28 pt-3 lg:pt-under-header-lg">
        <div className="flex items-center justify-between gap-3">
          <h1 className="hidden font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1 lg:block">Results</h1>
          <SegmentedControl<string>
            ariaLabel="Period"
            className="ml-auto w-[216px] shrink-0"
            value={String(days)}
            onChange={(v) => setDays(Number(v) as ResultPeriod)}
            options={RESULT_PERIODS.map((d) => ({ value: String(d), label: `${d}d` }))}
          />
        </div>

        {q.isLoading ? <div className={cn(card, 'h-40 animate-pulse')} /> : null}
        {q.isError ? <div className={card}><p className="text-row text-ink-2">Results are not available right now. Try again in a moment.</p></div> : null}
        {r ? <ResultsBody r={r} countryName={countryName} onGo={(to) => navigate(to)} /> : null}
      </main>
    </div>
  )
}

function ResultsBody({ r, countryName, onGo }: { r: BrandResults; countryName: (id: number) => string | null; onGo: (to: string) => void }) {
  const step = nextStep(r, countryName)
  const contactChange = changeLine(r.totals.contacted, r.previous.contacted)
  const hasOffers = r.offers.length > 0

  return (
    <>
      {r.waiting.count > 0 ? (
        <div className="flex items-center gap-3 rounded-[20px] bg-status-warning-soft p-4" data-testid="results-waiting">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-status-warning">{r.waiting.count} {r.waiting.count === 1 ? 'person is' : 'people are'} waiting</p>
            <p className="text-row text-status-warning/90">The oldest wrote {agoLine(r.waiting.oldest_at)}</p>
          </div>
          <Button size="small" className="shrink-0 rounded-full" onClick={() => onGo('/messages')}>Reply</Button>
        </div>
      ) : null}

      <div className="rounded-[24px] bg-brand-primary p-5 text-white" data-testid="results-contacted">
        <div className="flex items-start justify-between gap-2">
          <p className="text-row text-white/90">Members who contacted you</p>
          {contactChange ? <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-caption font-semibold">{contactChange}</span> : null}
        </div>
        <p className="mt-1 font-display text-[44px] font-bold leading-none tabular-nums">{r.totals.contacted}</p>
        <p className="mt-2 text-row text-white/90">From your offers, last {r.days} days</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="results-funnel">
        <Stat value={r.totals.shown} label="Shown to" />
        <Stat value={r.totals.opened} label="Opened" />
        <Stat value={r.totals.store_visits} label="To your store" />
        <Stat value={r.totals.code_copies} label="Copied the code" />
      </div>

      {step ? (
        <div className="rounded-[20px] bg-brand-soft p-4" data-testid="results-next-step">
          <p className={eyebrow}>Next step</p>
          <p className="mt-1 text-row text-brand-primary">{step.text}</p>
          <button type="button" onClick={() => onGo(step.to)} className="mt-3 inline-flex h-9 items-center rounded-full bg-white px-4 text-row font-semibold text-brand-primary">{step.action}</button>
        </div>
      ) : null}

      <section className={card} aria-label="Which offer works?">
        <p className={eyebrow}>Which offer works?</p>
        {hasOffers ? (
          <ul className="mt-3 space-y-4">
            {r.offers.map((o) => (
              <li key={o.id}>
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[10px] bg-brand-soft">{o.image_url ? <img src={o.image_url} alt="" className="h-full w-full object-cover" /> : null}</span>
                  <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-1">{o.title}</p>
                  {o.status !== 'live' ? <span className="text-caption text-ink-3">{o.status === 'paused' ? 'Paused' : 'Ended'}</span> : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  <Mini value={o.shown} label="Shown" />
                  <Mini value={o.opened} label="Opened" />
                  <Mini value={o.store_visits} label="To store" />
                  <Mini value={o.code_copies} label="Code" />
                  <Mini value={o.contacted} label="Contacted" />
                  <Mini value={o.not_useful} label="Not useful" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <p className="text-row text-ink-2">No offers yet. Results start when members see your first offer.</p>
            <Button size="small" className="mt-3 rounded-full" onClick={() => onGo('/dashboard/offers/new')}>Create an offer</Button>
          </div>
        )}
      </section>

      <section className={card} aria-label="People who contacted you">
        <p className={eyebrow}>Who wants to talk to you?</p>
        <h2 className={sectionTitle}>People who contacted you</h2>
        {r.contacts.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {r.contacts.map((c) => (
              <li key={c.profile_id} className="flex items-center gap-3">
                <Avatar src={c.avatar_url} alt={c.full_name ?? ''} role={c.role} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-row font-semibold text-ink-1">{c.full_name ?? 'Member'} · {roleLabel(c.role).replace(/s$/, '')}</p>
                  <p className="truncate text-secondary text-ink-2">{c.offer_title ? `From ${c.offer_title}` : 'From an offer'} · {agoLine(c.at)}</p>
                </div>
                <button type="button" onClick={() => onGo(c.conversation_id ? `/messages?conversation=${c.conversation_id}` : '/messages')} className="h-9 shrink-0 rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary">Message</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-row text-ink-2">Nobody has written from an offer in the last {r.days} days.</p>
        )}
      </section>

      <section className={card} aria-label="Who you could reach">
        <p className={eyebrow}>How big is your market?</p>
        <h2 className={sectionTitle}>Who you could reach</h2>
        <p className="mt-2 flex items-baseline gap-2"><span className="font-display text-[32px] font-bold leading-none tabular-nums text-ink-1">{r.market_total ?? 'Fewer than 5'}</span>{r.market_total != null ? <span className="text-row text-ink-2">members live where you sell</span> : null}</p>
        {r.market.length > 0 ? (
          <ul className="mt-3 divide-y divide-line">
            {r.market.map((m) => (
              <li key={m.country_id} className="flex items-center gap-3 py-2.5 text-row">
                <span className="min-w-0 flex-1 truncate text-ink-1">{countryName(m.country_id) ?? 'Country'}</span>
                <span className="tabular-nums text-ink-1">{m.n ?? 'Fewer than 5'}</span>
                {m.covered
                  ? <span className="w-36 text-right text-secondary font-semibold text-status-positive">Your offers show here</span>
                  : <button type="button" onClick={() => onGo('/dashboard/offers')} className="w-36 text-right text-secondary font-semibold text-brand-primary">Add to an offer</button>}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-caption text-ink-3">Members who live there today, counted only in groups of 5 or more. Nobody is identified.</p>
      </section>

      <section className={card} aria-label="Who saw your offers">
        <p className={eyebrow}>Where should you show it?</p>
        <h2 className={sectionTitle}>Who saw your offers</h2>
        <Breakdown
          total={r.seen_total}
          tabs={[
            { key: 'country', label: 'Country', rows: r.by_country.map((x) => ({ label: countryName(x.country_id) ?? 'Country', n: x.n })) },
            { key: 'role', label: 'Role', rows: r.by_role.map((x) => ({ label: roleLabel(x.role), n: x.n })) },
            { key: 'where', label: 'Where', rows: r.by_surface.map((x) => ({ label: surfaceLabel(x.surface), n: x.n })) },
          ]}
        />
      </section>

      {r.products.length > 0 ? (
        <section className={card} aria-label="Products">
          <h2 className="text-title text-ink-1">Products</h2>
          <ul className="mt-2 divide-y divide-line">
            {r.products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-row">
                <span className="min-w-0 truncate text-ink-1">{p.name}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{p.seen} seen · {p.store_taps} to store</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={card} aria-label="Ambassadors and followers">
        <h2 className="text-title text-ink-1">Ambassadors and followers</h2>
        <dl className="mt-2 divide-y divide-line text-row">
          <Row label="Active ambassadors" value={String(r.community.ambassadors)} />
          <Row label="Invites accepted" value={`${r.community.invites_accepted} of ${r.community.invites_sent}`} />
          <Row label="New followers" value={String(r.community.new_followers)} />
        </dl>
        <button type="button" onClick={() => onGo('/dashboard/ambassadors')} className="mt-3 text-row font-semibold text-brand-primary">Find ambassadors ›</button>
      </section>
      <p className="px-1 text-caption text-ink-3">Counts are distinct members. Test accounts, hidden profiles and your own visits are never counted.</p>
    </>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[16px] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
      <p className="text-title tabular-nums text-ink-1">{value}</p>
      <p className="text-secondary text-ink-2">{label}</p>
    </div>
  )
}

function Mini({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[12px] bg-surface-subtle px-2.5 py-2">
      <p className="text-body font-semibold tabular-nums text-ink-1">{value}</p>
      <p className="truncate text-caption text-ink-2">{label}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular-nums text-ink-1">{value}</dd>
    </div>
  )
}

function Breakdown({ total, tabs }: { total: number; tabs: { key: string; label: string; rows: { label: string; n: number }[] }[] }) {
  const [tab, setTab] = useState(tabs[0].key)
  const rows = tabs.find((t) => t.key === tab)?.rows ?? []
  const max = Math.max(1, ...rows.map((x) => x.n))
  const counted = rows.reduce((s, x) => s + x.n, 0)
  return (
    <div className="mt-3">
      <SegmentedControl<string> ariaLabel="Breakdown" value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t.key, label: t.label }))} className="w-full max-w-[300px]" />
      {total === 0 ? (
        <p className="mt-3 text-row text-ink-2">Nobody has seen your offers in this period yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((x) => (
            <li key={x.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
              <span className="truncate text-row text-ink-1">{x.label}</span>
              <span className="row-span-2 text-row font-semibold tabular-nums text-ink-1">{x.n}</span>
              <span className="h-1.5 rounded-full bg-surface-muted"><span className="block h-1.5 rounded-full bg-brand-primary" style={{ width: `${Math.round((x.n / max) * 100)}%` }} /></span>
            </li>
          ))}
          {total > counted ? (
            <li className="flex items-center justify-between text-row text-ink-2"><span>{rows.length ? 'Others' : 'Everyone'}</span><span>Fewer than 5 each</span></li>
          ) : null}
        </ul>
      )}
    </div>
  )
}
