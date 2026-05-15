/**
 * DateOfBirthPicker — three native <select>s for fast DoB entry.
 *
 * Pins the contracts that matter:
 *   - ISO YYYY-MM-DD in/out, '' for incomplete/empty
 *   - Clears day when year/month change makes it invalid (Feb 29 in non-leap)
 *   - Year list is descending (newest first) so adults pick fast
 */

import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'

/**
 * Controlled wrapper for tests that drive the picker through multiple
 * selections — the real component is controlled, so the parent must
 * re-render with the new value between user actions.
 */
function ControlledHarness({
  initial = '',
  onChange,
  maxYear,
  minYear,
}: {
  initial?: string
  onChange?: (v: string) => void
  maxYear?: number
  minYear?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <DateOfBirthPicker
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      maxYear={maxYear}
      minYear={minYear}
    />
  )
}

describe('DateOfBirthPicker', () => {
  it('parses an ISO YYYY-MM-DD value and shows it across the three selects', () => {
    render(<DateOfBirthPicker value="1985-07-15" onChange={() => {}} />)
    expect((screen.getByLabelText('Day') as HTMLSelectElement).value).toBe('15')
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('7')
    expect((screen.getByLabelText('Year') as HTMLSelectElement).value).toBe('1985')
  })

  it('shows empty placeholders for empty value', () => {
    render(<DateOfBirthPicker value="" onChange={() => {}} />)
    expect((screen.getByLabelText('Day') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Year') as HTMLSelectElement).value).toBe('')
  })

  it('emits an ISO date once all three parts are filled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ControlledHarness onChange={onChange} maxYear={2000} minYear={1950} />)

    await user.selectOptions(screen.getByLabelText('Year'), '1985')
    expect(onChange).toHaveBeenLastCalledWith('')
    await user.selectOptions(screen.getByLabelText('Month'), '7')
    expect(onChange).toHaveBeenLastCalledWith('')
    await user.selectOptions(screen.getByLabelText('Day'), '15')
    expect(onChange).toHaveBeenLastCalledWith('1985-07-15')
  })

  it('emits empty string when any part is cleared (partial input is not a valid DoB)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ControlledHarness initial="1985-07-15" onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('Month'), '')
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('clears day when year change makes Feb 29 invalid (leap → non-leap)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ControlledHarness initial="2024-02-29" onChange={onChange} maxYear={2024} minYear={2020} />,
    )
    await user.selectOptions(screen.getByLabelText('Year'), '2023')
    // 2023 is not a leap year → Feb 29 invalid → day cleared → empty serialize
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('clears day when month change drops the max day below the current day', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ControlledHarness initial="2000-03-31" onChange={onChange} maxYear={2000} minYear={1990} />,
    )
    await user.selectOptions(screen.getByLabelText('Month'), '4') // April has 30 days
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('keeps day when month change is within range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ControlledHarness initial="2000-03-15" onChange={onChange} maxYear={2000} minYear={1990} />,
    )
    await user.selectOptions(screen.getByLabelText('Month'), '4')
    expect(onChange).toHaveBeenLastCalledWith('2000-04-15')
  })

  it('lists years in descending order (newest first)', () => {
    render(<DateOfBirthPicker value="" onChange={() => {}} maxYear={2024} minYear={2020} />)
    const yearSelect = screen.getByLabelText('Year') as HTMLSelectElement
    const yearOptions = Array.from(yearSelect.options)
      .map((o) => o.value)
      .filter((v) => v !== '')
    expect(yearOptions).toEqual(['2024', '2023', '2022', '2021', '2020'])
  })

  it('renders 29 days for Feb in a leap year, 28 in a non-leap year', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <DateOfBirthPicker value="2024-02-15" onChange={onChange} maxYear={2024} minYear={2020} />,
    )
    let daySelect = screen.getByLabelText('Day') as HTMLSelectElement
    expect(daySelect.options.length).toBe(30) // placeholder + 29

    // Switch to a non-leap year — day 15 stays valid, but max day becomes 28
    rerender(
      <DateOfBirthPicker value="2023-02-15" onChange={onChange} maxYear={2024} minYear={2020} />,
    )
    daySelect = screen.getByLabelText('Day') as HTMLSelectElement
    expect(daySelect.options.length).toBe(29) // placeholder + 28
    // Verify Feb 15 stays selected (no day-clamp side effect when day already valid)
    expect(daySelect.value).toBe('15')
    expect(onChange).not.toHaveBeenCalled()

    await user.selectOptions(daySelect, '15')
    expect(onChange).toHaveBeenLastCalledWith('2023-02-15')
  })

  it('ignores malformed value and shows empty selects', () => {
    render(<DateOfBirthPicker value="not-a-date" onChange={() => {}} />)
    expect((screen.getByLabelText('Day') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Year') as HTMLSelectElement).value).toBe('')
  })
})
