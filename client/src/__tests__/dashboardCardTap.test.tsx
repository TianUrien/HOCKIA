/**
 * DashboardCard — whole-card tap wiring.
 *
 * Regression guard for the bug where the card's own role="button" matched the
 * "ignore inner interactive" guard (closest('[role="button"]') hit the card
 * itself), so tapping the body animated but never navigated.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Play } from 'lucide-react'
import DashboardCard from '@/components/dashboard/bento/DashboardCard'

describe('DashboardCard — whole-card tap', () => {
  it('navigates when the card BODY is tapped (not just the CTA)', async () => {
    const onCta = vi.fn()
    render(
      <DashboardCard icon={Play} title="Media" subtitle="sub" ctaLabel="Manage media" onCtaClick={onCta}>
        <p>body content</p>
      </DashboardCard>,
    )
    await userEvent.click(screen.getByText('body content'))
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('navigates when the title is tapped', async () => {
    const onCta = vi.fn()
    render(<DashboardCard icon={Play} title="Career History" ctaLabel="View all" onCtaClick={onCta} />)
    await userEvent.click(screen.getByText('Career History'))
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('fires the CTA exactly once when the CTA itself is tapped (no double from bubbling)', async () => {
    const onCta = vi.fn()
    render(<DashboardCard icon={Play} title="Media" ctaLabel="Manage media" onCtaClick={onCta} />)
    await userEvent.click(screen.getByRole('button', { name: 'Manage media' }))
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('lets an INNER button handle its own tap without triggering card nav', async () => {
    const onCta = vi.fn()
    const onInner = vi.fn()
    render(
      <DashboardCard icon={Play} title="Network" ctaLabel="Go to my network" onCtaClick={onCta}>
        <button type="button" onClick={onInner}>Connections</button>
      </DashboardCard>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onCta).not.toHaveBeenCalled()
  })

  it('activates on keyboard Enter when the card is focused', async () => {
    const onCta = vi.fn()
    render(<DashboardCard icon={Play} title="Media" ctaLabel="Manage media" onCtaClick={onCta} />)
    const card = screen.getByRole('button', { name: 'Media — Manage media' })
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('is not a button (not tappable) when there is no onCtaClick', () => {
    render(<DashboardCard icon={Play} title="Static" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is not tappable when onCtaClick is set but ctaLabel is missing (no visible affordance)', async () => {
    const onCta = vi.fn()
    render(
      <DashboardCard icon={Play} title="Empty" onCtaClick={onCta}>
        <p>nothing yet</p>
      </DashboardCard>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    await userEvent.click(screen.getByText('nothing yet'))
    expect(onCta).not.toHaveBeenCalled()
  })

  it('does not navigate when an open overlay (role="tooltip") inside the body is tapped', async () => {
    const onCta = vi.fn()
    render(
      <DashboardCard icon={Play} title="Opportunities" ctaLabel="View opportunities" onCtaClick={onCta}>
        <div role="tooltip">Open to play means clubs can find you.</div>
      </DashboardCard>,
    )
    await userEvent.click(screen.getByText('Open to play means clubs can find you.'))
    expect(onCta).not.toHaveBeenCalled()
  })

  it('does not hijack an inner <a> link (Club website/email — closes R5 by mechanism)', async () => {
    const onCta = vi.fn()
    const onLink = vi.fn((e: { preventDefault: () => void }) => e.preventDefault()) // avoid jsdom navigation
    render(
      <DashboardCard icon={Play} title="Club information" ctaLabel="Edit" onCtaClick={onCta}>
        <a href="https://example.com" onClick={onLink}>example.com</a>
      </DashboardCard>,
    )
    await userEvent.click(screen.getByRole('link', { name: 'example.com' }))
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(onCta).not.toHaveBeenCalled() // the card did not steal the link's tap
  })
})
