import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { handleNativeBack, type BackDeps } from '@/lib/nativeBack'
import { activeFocusTrapCount } from '@/hooks/useFocusTrap'
import { BottomSheet } from '@/components/ui/BottomSheet'

/**
 * Android system Back (lib/nativeBack.ts): with a sheet or modal open it
 * closes the top one, like Escape on the web; otherwise it navigates; at the
 * first screen it sends the app to the background. Before, Back navigated
 * the screen behind an open sheet (device lab, 2026-11-21).
 */
const deps = (over: Partial<BackDeps> & { counts: number[] }): BackDeps & { goBack: ReturnType<typeof vi.fn>; leaveApp: ReturnType<typeof vi.fn>; pressEscape: ReturnType<typeof vi.fn> } => {
  const counts = [...over.counts]
  return {
    overlayCount: () => (counts.length > 1 ? (counts.shift() as number) : counts[0]),
    pressEscape: vi.fn(),
    goBack: vi.fn(),
    leaveApp: vi.fn(),
    wait: () => Promise.resolve(),
    ...over,
  } as never
}

describe('one Back press', () => {
  it('closes the open overlay and does not navigate', async () => {
    const d = deps({ counts: [1, 0] })
    expect(await handleNativeBack(true, d)).toBe('closed-overlay')
    expect(d.pressEscape).toHaveBeenCalledTimes(1)
    expect(d.goBack).not.toHaveBeenCalled()
    expect(d.leaveApp).not.toHaveBeenCalled()
  })

  it('with two stacked overlays closes one layer only', async () => {
    const d = deps({ counts: [2, 1] })
    expect(await handleNativeBack(true, d)).toBe('closed-overlay')
    expect(d.pressEscape).toHaveBeenCalledTimes(1)
    expect(d.goBack).not.toHaveBeenCalled()
  })

  it('with nothing open navigates back, as before', async () => {
    const d = deps({ counts: [0] })
    expect(await handleNativeBack(true, d)).toBe('navigated')
    expect(d.pressEscape).not.toHaveBeenCalled()
    expect(d.goBack).toHaveBeenCalledTimes(1)
  })

  it('at the first screen sends the app to the background', async () => {
    const d = deps({ counts: [0] })
    expect(await handleNativeBack(false, d)).toBe('left-app')
    expect(d.leaveApp).toHaveBeenCalledTimes(1)
    expect(d.goBack).not.toHaveBeenCalled()
  })

  it('an overlay that ignores Escape never traps the member: Back falls through to navigation', async () => {
    const d = deps({ counts: [1, 1] })
    expect(await handleNativeBack(true, d)).toBe('navigated')
    expect(d.pressEscape).toHaveBeenCalledTimes(1)
    expect(d.goBack).toHaveBeenCalledTimes(1)
  })
})

function Sheets() {
  const [first, setFirst] = useState(true)
  const [second, setSecond] = useState(true)
  return (
    <>
      <BottomSheet open={first} onClose={() => setFirst(false)} ariaLabel="First"><button type="button">one</button></BottomSheet>
      <BottomSheet open={second} onClose={() => setSecond(false)} ariaLabel="Second"><button type="button">two</button></BottomSheet>
    </>
  )
}

describe('with the real sheets', () => {
  const real = (): BackDeps & { goBack: ReturnType<typeof vi.fn> } => ({
    overlayCount: activeFocusTrapCount,
    pressEscape: () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) },
    goBack: vi.fn(),
    leaveApp: vi.fn(),
    wait: () => act(async () => { await Promise.resolve() }),
  }) as never

  it('Back closes the top sheet, then the one under it, then navigates', async () => {
    render(<Sheets />)
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    expect(activeFocusTrapCount()).toBe(2)

    const d = real()
    let done = ''
    await act(async () => { done = await handleNativeBack(true, d) })
    expect(done).toBe('closed-overlay')
    expect(screen.queryByRole('dialog', { name: 'Second' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()

    await act(async () => { done = await handleNativeBack(true, d) })
    expect(done).toBe('closed-overlay')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(d.goBack).not.toHaveBeenCalled()

    await act(async () => { done = await handleNativeBack(true, d) })
    expect(done).toBe('navigated')
    expect(d.goBack).toHaveBeenCalledTimes(1)
  })
})
