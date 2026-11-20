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
  roleLabelOne,
  surfaceLabel,
  type BrandResults,
  type ResultPeriod,
} from '@/lib/brandResults'
import { brandCount } from '@/lib/brandOffers'
import { useBrandsT } from '@/i18n/ns/brands'

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
  const t = useBrandsT()
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
      <DetailNavBar parent={t('results.navParent')} title={t('results.title')} fallbackPath="/dashboard/profile" />
      <main className="mx-auto max-w-[720px] space-y-3 px-4 pb-28 pt-3 lg:pt-under-header-lg">
        <div className="flex items-center justify-between gap-3">
          <h1 className="hidden font-display text-[40px] font-bold leading-[1.1] tracking-[-0.035em] text-ink-1 lg:block">{t('results.title')}</h1>
          <SegmentedControl<string>
            ariaLabel={t('results.periodAria')}
            className="ml-auto w-[216px] shrink-0"
            value={String(days)}
            onChange={(v) => setDays(Number(v) as ResultPeriod)}
            options={RESULT_PERIODS.map((d) => ({ value: String(d), label: t('results.periodShort', { days: d }) }))}
          />
        </div>

        {q.isLoading ? <div className={cn(card, 'h-40 animate-pulse')} /> : null}
        {q.isError ? <div className={card}><p className="text-row text-ink-2">{t('results.error')}</p></div> : null}
        {r ? <ResultsBody r={r} countryName={countryName} onGo={(to) => navigate(to)} /> : null}
      </main>
    </div>
  )
}

function ResultsBody({ r, countryName, onGo }: { r: BrandResults; countryName: (id: number) => string | null; onGo: (to: string) => void }) {
  const t = useBrandsT()
  const step = nextStep(r, countryName)
  const contactChange = changeLine(r.totals.contacted, r.previous.contacted)
  const hasOffers = r.offers.length > 0

  return (
    <>
      {r.waiting.count > 0 ? (
        <div className="flex items-center gap-3 rounded-[20px] bg-status-warning-soft p-4" data-testid="results-waiting">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-status-warning">{t('results.waiting.title', { count: r.waiting.count, n: brandCount(r.waiting.count) })}</p>
            <p className="text-row text-status-warning/90">{t('results.waiting.oldest', { ago: agoLine(r.waiting.oldest_at) })}</p>
          </div>
          <Button size="small" className="shrink-0 rounded-full" onClick={() => onGo('/messages')}>{t('results.waiting.reply')}</Button>
        </div>
      ) : null}

      <div className="rounded-[24px] bg-brand-primary p-5 text-white" data-testid="results-contacted">
        <div className="flex items-start justify-between gap-2">
          <p className="text-row text-white/90">{t('results.contacted.label')}</p>
          {contactChange ? <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-caption font-semibold">{contactChange}</span> : null}
        </div>
        <p className="mt-1 font-display text-[44px] font-bold leading-none tabular-nums">{brandCount(r.totals.contacted)}</p>
        <p className="mt-2 text-row text-white/90">{t('results.contacted.period', { count: r.days })}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="results-funnel">
        <Stat value={r.totals.shown} label={t('results.funnel.shown')} />
        <Stat value={r.totals.opened} label={t('results.funnel.opened')} />
        <Stat value={r.totals.store_visits} label={t('results.funnel.store')} />
        <Stat value={r.totals.code_copies} label={t('results.funnel.code')} />
      </div>

      {step ? (
        <div className="rounded-[20px] bg-brand-soft p-4" data-testid="results-next-step">
          <p className={eyebrow}>{t('results.nextStep')}</p>
          <p className="mt-1 text-row text-brand-primary">{step.text}</p>
          <button type="button" onClick={() => onGo(step.to)} className="mt-3 inline-flex h-9 items-center rounded-full bg-white px-4 text-row font-semibold text-brand-primary">{step.action}</button>
        </div>
      ) : null}

      <section className={card} aria-label={t('results.offers.eyebrow')}>
        <p className={eyebrow}>{t('results.offers.eyebrow')}</p>
        {hasOffers ? (
          <ul className="mt-3 space-y-4">
            {r.offers.map((o) => (
              <li key={o.id}>
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[10px] bg-brand-soft">{o.image_url ? <img src={o.image_url} alt="" className="h-full w-full object-cover" /> : null}</span>
                  <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-1">{o.title}</p>
                  {o.status !== 'live' ? <span className="text-caption text-ink-3">{o.status === 'paused' ? t('results.offers.paused') : t('results.offers.ended')}</span> : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  <Mini value={o.shown} label={t('results.offers.shown')} />
                  <Mini value={o.opened} label={t('results.offers.opened')} />
                  <Mini value={o.store_visits} label={t('results.offers.store')} />
                  <Mini value={o.code_copies} label={t('results.offers.code')} />
                  <Mini value={o.contacted} label={t('results.offers.contacted')} />
                  <Mini value={o.not_useful} label={t('results.offers.notUseful')} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <p className="text-row text-ink-2">{t('results.offers.empty')}</p>
            <Button size="small" className="mt-3 rounded-full" onClick={() => onGo('/dashboard/offers/new')}>{t('results.offers.create')}</Button>
          </div>
        )}
      </section>

      <section className={card} aria-label={t('results.contacts.title')}>
        <p className={eyebrow}>{t('results.contacts.eyebrow')}</p>
        <h2 className={sectionTitle}>{t('results.contacts.title')}</h2>
        {r.contacts.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {r.contacts.map((c) => (
              <li key={c.profile_id} className="flex items-center gap-3">
                <Avatar src={c.avatar_url} alt={c.full_name ?? ''} role={c.role} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-row font-semibold text-ink-1">{c.full_name ?? t('results.contacts.member')}{' '}<span className="ml-2 font-normal text-ink-2">{roleLabelOne(c.role)}</span></p>
                  <p className="truncate text-secondary text-ink-2">{c.offer_title ? t('results.contacts.fromOffer', { title: c.offer_title }) : t('results.contacts.fromAnOffer')}{' '}<span className="ml-2 text-ink-3">{agoLine(c.at)}</span></p>
                </div>
                <button type="button" onClick={() => onGo(c.conversation_id ? `/messages?conversation=${c.conversation_id}` : '/messages')} className="h-9 shrink-0 rounded-full bg-brand-soft px-4 text-row font-semibold text-brand-primary">{t('results.contacts.message')}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-row text-ink-2">{t('results.contacts.empty', { count: r.days })}</p>
        )}
      </section>

      <section className={card} aria-label={t('results.market.title')}>
        <p className={eyebrow}>{t('results.market.eyebrow')}</p>
        <h2 className={sectionTitle}>{t('results.market.title')}</h2>
        <p className="mt-2 flex items-baseline gap-2"><span className="font-display text-[32px] font-bold leading-none tabular-nums text-ink-1">{r.market_total != null ? brandCount(r.market_total) : t('results.fewerThan5')}</span>{r.market_total != null ? <span className="text-row text-ink-2">{t('results.market.totalLabel', { count: r.market_total })}</span> : null}</p>
        {r.market.length > 0 ? (
          <ul className="mt-3 divide-y divide-line">
            {r.market.map((m) => (
              <li key={m.country_id} className="flex items-center gap-3 py-2.5 text-row">
                <span className="min-w-0 flex-1 truncate text-ink-1">{countryName(m.country_id) ?? t('results.country')}</span>
                <span className="tabular-nums text-ink-1">{m.n != null ? brandCount(m.n) : t('results.fewerThan5')}</span>
                {m.covered
                  ? <span className="w-36 text-right text-secondary font-semibold text-status-positive">{t('results.market.covered')}</span>
                  : <button type="button" onClick={() => onGo('/dashboard/offers')} className="w-36 text-right text-secondary font-semibold text-brand-primary">{t('results.market.add')}</button>}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-caption text-ink-3">{t('results.market.note')}</p>
      </section>

      <section className={card} aria-label={t('results.seen.title')}>
        <p className={eyebrow}>{t('results.seen.eyebrow')}</p>
        <h2 className={sectionTitle}>{t('results.seen.title')}</h2>
        <Breakdown
          total={r.seen_total}
          tabs={[
            { key: 'country', label: t('results.seen.country'), rows: r.by_country.map((x) => ({ label: countryName(x.country_id) ?? t('results.country'), n: x.n })) },
            { key: 'role', label: t('results.seen.role'), rows: r.by_role.map((x) => ({ label: roleLabel(x.role), n: x.n })) },
            { key: 'where', label: t('results.seen.where'), rows: r.by_surface.map((x) => ({ label: surfaceLabel(x.surface), n: x.n })) },
          ]}
        />
      </section>

      {r.products.length > 0 ? (
        <section className={card} aria-label={t('results.products.title')}>
          <h2 className="text-title text-ink-1">{t('results.products.title')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {r.products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-row">
                <span className="min-w-0 truncate text-ink-1">{p.name}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{t('results.products.line', { seen: brandCount(p.seen), store: brandCount(p.store_taps) })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={card} aria-label={t('results.community.title')}>
        <h2 className="text-title text-ink-1">{t('results.community.title')}</h2>
        <dl className="mt-2 divide-y divide-line text-row">
          <Row label={t('results.community.ambassadors')} value={brandCount(r.community.ambassadors)} />
          <Row label={t('results.community.invites')} value={t('results.community.invitesValue', { accepted: brandCount(r.community.invites_accepted), sent: brandCount(r.community.invites_sent) })} />
          <Row label={t('results.community.followers')} value={brandCount(r.community.new_followers)} />
        </dl>
        <button type="button" onClick={() => onGo('/dashboard/ambassadors')} className="mt-3 text-row font-semibold text-brand-primary">{t('results.community.find')}</button>
      </section>
      <p className="px-1 text-caption text-ink-3">{t('results.footnote')}</p>
    </>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[16px] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
      <p className="text-title tabular-nums text-ink-1">{brandCount(value)}</p>
      <p className="text-secondary text-ink-2">{label}</p>
    </div>
  )
}

function Mini({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[12px] bg-surface-subtle px-2.5 py-2">
      <p className="text-body font-semibold tabular-nums text-ink-1">{brandCount(value)}</p>
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
  const t = useBrandsT()
  const [tab, setTab] = useState(tabs[0].key)
  const rows = tabs.find((x) => x.key === tab)?.rows ?? []
  const max = Math.max(1, ...rows.map((x) => x.n))
  const counted = rows.reduce((s, x) => s + x.n, 0)
  return (
    <div className="mt-3">
      <SegmentedControl<string> ariaLabel={t('results.seen.breakdownAria')} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x.key, label: x.label }))} className="w-full max-w-[300px]" />
      {total === 0 ? (
        <p className="mt-3 text-row text-ink-2">{t('results.seen.empty')}</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((x) => (
            <li key={x.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
              <span className="truncate text-row text-ink-1">{x.label}</span>
              <span className="row-span-2 text-row font-semibold tabular-nums text-ink-1">{brandCount(x.n)}</span>
              <span className="h-1.5 rounded-full bg-surface-muted"><span className="block h-1.5 rounded-full bg-brand-primary" style={{ width: `${Math.round((x.n / max) * 100)}%` }} /></span>
            </li>
          ))}
          {total > counted ? (
            <li className="flex items-center justify-between text-row text-ink-2"><span>{rows.length ? t('results.seen.others') : t('results.seen.everyone')}</span><span>{t('results.seen.fewerEach')}</span></li>
          ) : null}
        </ul>
      )}
    </div>
  )
}
