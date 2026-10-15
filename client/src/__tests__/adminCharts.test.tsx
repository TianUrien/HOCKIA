import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { completeDaysOnly, share, shareLabel, shortDay, toWeekly, weekStart } from '@/features/admin/lib/adminCharts'
import { DonutChartCard } from '@/features/admin/components/charts/DonutChartCard'
import { RankedBarsCard } from '@/features/admin/components/charts/RankedBarsCard'

describe('adminCharts helpers', () => {
  it('weekStart is the Monday on or before the date', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12') // Thursday → Monday
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // Monday stays
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday → previous Monday
  })

  it('toWeekly sums daily rows into ordered Monday-start weeks', () => {
    const daily = [
      { date: '2026-10-05', players: 1, coaches: 0 },
      { date: '2026-10-09', players: 2, coaches: 1 },
      { date: '2026-10-12', players: 3, coaches: 0 },
      { date: '2026-10-01', players: 5, coaches: 5 },
    ]
    const weeks = toWeekly(daily, 'date', ['players', 'coaches'], '2026-10-15')
    expect(weeks.map((w) => w.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
    expect(weeks[1]).toMatchObject({ players: 3, coaches: 1, label: '5 Oct', partial: false })
    expect(weeks[2].partial).toBe(true) // the week that contains today is still filling
  })

  it('share, shareLabel, shortDay and completeDaysOnly', () => {
    expect(share(1, 3)).toBe(33)
    expect(share(1, 0)).toBeNull() // no denominator → N/A, never 0%
    expect(shareLabel(1, 0)).toBe('—')
    expect(shortDay('2026-10-05')).toBe('5 Oct')
    expect(completeDaysOnly([{ day: '2026-10-14' }, { day: '2026-10-15' }], '2026-10-15')).toEqual([{ day: '2026-10-14' }])
  })
})

describe('chart cards', () => {
  it('DonutChartCard keeps zero slices in the legend and shows the total in the middle', () => {
    render(<DonutChartCard title="Members by role" slices={[{ label: 'Players', value: 3, color: '#000' }, { label: 'Umpires', value: 0, color: '#111' }]} centerLabel="members" total={4} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Umpires')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('DonutChartCard shows the empty state when everything is zero', () => {
    render(<DonutChartCard title="Roles" slices={[{ label: 'Open', value: 0, color: '#000' }]} centerLabel="roles" />)
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()
  })

  it('RankedBarsCard ranks, limits and folds the rest into Other', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ label: `C${i}`, value: 10 - i }))
    render(<RankedBarsCard title="Top countries" bars={bars} limit={3} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toMatch(/^C010/)
    expect(items).toHaveLength(4)
    expect(items[3]).toMatch(/^Other/)
  })
})
