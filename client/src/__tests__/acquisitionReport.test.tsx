import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const m = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: m.rpc } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
// recharts measures a ResponsiveContainer; jsdom has no layout, so stub it.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: () => null, Tooltip: () => null }
})

import { AcquisitionReport } from '@/features/admin/components/AcquisitionReport'
import { colorForSources } from '@/lib/attributionLabels'

const report = {
  period_days: 30, total_signups: 10,
  channels: [
    { source: 'direct', group: 'direct', signups: 6, activated: 3, prev_signups: 8 },
    { source: 'instagram', group: 'social', signups: 3, activated: 2, prev_signups: 1 },
    { source: 'google_organic', group: 'search', signups: 1, activated: 1, prev_signups: 2 },
  ],
  methods: { utm: 3, backfilled: 7 }, confidence: {}, platforms: { web: 10 },
}

describe('AcquisitionReport', () => {
  beforeEach(() => { m.rpc.mockReset() })

  it('crowns the leading IDENTIFIED source, never direct — even when direct has the most signups', async () => {
    m.rpc.mockResolvedValue({ data: report, error: null })
    render(<AcquisitionReport days={30} />)
    await waitFor(() => expect(screen.getByTestId('acquisition-leader')).toBeInTheDocument())
    const leader = screen.getByTestId('acquisition-leader')
    expect(leader).toHaveTextContent('Leading source right now')
    expect(leader).toHaveTextContent('Instagram')
    expect(leader).toHaveTextContent('3 of 10 signups (30%)')
    expect(leader).toHaveTextContent('+2 vs previous 30d')
    expect(leader).toHaveTextContent('2/3 activated')
    expect(leader).toHaveTextContent('4 of 10 came through an identifiable channel')
    expect(m.rpc).toHaveBeenCalledWith('admin_get_acquisition_report', { p_days: 30 })
  })

  it('ranks every source with share, delta and activation', async () => {
    m.rpc.mockResolvedValue({ data: report, error: null })
    render(<AcquisitionReport days={30} />)
    await waitFor(() => expect(screen.getByTestId('acq-row-direct')).toBeInTheDocument())
    expect(screen.getByTestId('acq-row-direct')).toHaveTextContent('Direct')
    expect(screen.getByTestId('acq-row-direct')).toHaveTextContent('60%')
    expect(screen.getByTestId('acq-row-direct')).toHaveTextContent('-2')
    expect(screen.getByTestId('acq-row-google_organic')).toHaveTextContent('Google (organic)')
    expect(screen.getByTestId('acq-row-google_organic')).toHaveTextContent('1/1')
    expect(screen.getByTestId('acquisition-report')).toHaveTextContent('Measured (utm / referrer / deep link): 3 of 10')
  })

  it('says so when nothing identifiable exists yet', async () => {
    m.rpc.mockResolvedValue({ data: { ...report, total_signups: 4, channels: [{ source: 'direct', group: 'direct', signups: 3, activated: 1, prev_signups: 0 }, { source: 'unknown', group: 'unknown', signups: 1, activated: 0, prev_signups: 0 }] }, error: null })
    render(<AcquisitionReport days={7} />)
    await waitFor(() => expect(screen.getByTestId('acquisition-leader')).toBeInTheDocument())
    expect(screen.getByTestId('acquisition-leader')).toHaveTextContent('No identifiable source yet')
  })

  it('colours: non-channels are grey, identified sources get distinct palette colours', () => {
    const color = colorForSources(report.channels.map((c) => c.source))
    expect(color('direct')).toBe('#9ca3af')
    expect(color('unknown')).toBe('#d1d5db')
    expect(color('instagram')).not.toBe(color('google_organic'))
    expect(color('instagram')).not.toBe('#9ca3af')
  })

  it('shows the empty and error states', async () => {
    m.rpc.mockResolvedValueOnce({ data: { ...report, total_signups: 0, channels: [] }, error: null })
    render(<AcquisitionReport days={30} />)
    await waitFor(() => expect(screen.getByTestId('acquisition-empty')).toBeInTheDocument())
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<AcquisitionReport days={7} />)
    await waitFor(() => expect(screen.getByTestId('acquisition-error')).toBeInTheDocument())
  })
})
