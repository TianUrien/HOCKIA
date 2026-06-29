/**
 * bottomPrompt coordinator — cross-component contract.
 *
 * The AI FAB (an "observer") hides when the rating card / install / push prompt
 * (a "claimer") is visible. This locks that mechanism: when one prompt claims a
 * slot, another component reading `otherActive` sees it, and it clears on release.
 */
import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { useBottomPrompt } from '@/lib/bottomPrompt'

function Claimer({ visible }: { visible: boolean }) {
  useBottomPrompt('claimer', visible)
  return null
}

function Observer() {
  const other = useBottomPrompt('observer', false) // never claims; only reads (like the FAB)
  return <div data-testid="obs">{other ? 'other-active' : 'idle'}</div>
}

function Harness() {
  const [visible, setVisible] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setVisible(true)}>show</button>
      <button type="button" onClick={() => setVisible(false)}>hide</button>
      <Claimer visible={visible} />
      <Observer />
    </>
  )
}

describe('bottomPrompt coordinator', () => {
  it('an observer sees otherActive when another prompt claims a slot, and clears on release', () => {
    render(<Harness />)
    expect(screen.getByTestId('obs').textContent).toBe('idle')

    act(() => { screen.getByText('show').click() })
    expect(screen.getByTestId('obs').textContent).toBe('other-active')

    act(() => { screen.getByText('hide').click() })
    expect(screen.getByTestId('obs').textContent).toBe('idle')
  })
})
