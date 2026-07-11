import { render } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * useImpressionOnce must fire even for modules that render a ref-LESS loading
 * branch first and only attach the ref once data arrives (the hero + the
 * applications list do exactly that). The old object-ref + mount-only effect
 * silently never fired for them — a measurement-integrity bug on the two
 * flagship Phase-1 player modules. A callback ref fixes it; this pins that.
 */

// Auto-firing IntersectionObserver: reports visible the moment observe() runs.
class AutoIO {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', AutoIO)
})

// A component that mounts ref-LESS first (loading), then swaps to the
// ref-bearing node — the exact shape of PlayerHero / YourApplications.
function AsyncGatedModule({ onVisible }: { onVisible: () => void }) {
  const ref = useImpressionOnce(onVisible)
  const [loaded, setLoaded] = useState(false)
  return (
    <div>
      <button onClick={() => setLoaded(true)}>load</button>
      {loaded ? <div ref={ref} data-testid="loaded">content</div> : <div data-testid="skeleton">…</div>}
    </div>
  )
}

describe('useImpressionOnce (callback ref)', () => {
  it('fires when the ref node mounts AFTER a ref-less loading render', async () => {
    const onVisible = vi.fn()
    const { getByText, findByTestId } = render(<AsyncGatedModule onVisible={onVisible} />)

    // First paint is the skeleton — no ref, must not fire yet.
    expect(onVisible).not.toHaveBeenCalled()

    // Data arrives → ref node mounts → observer attaches → fires.
    getByText('load').click()
    await findByTestId('loaded')
    expect(onVisible).toHaveBeenCalledTimes(1)
  })

  it('fires once for a node present from first render', () => {
    const onVisible = vi.fn()
    function Immediate() {
      const ref = useImpressionOnce(onVisible)
      return <div ref={ref} />
    }
    render(<Immediate />)
    expect(onVisible).toHaveBeenCalledTimes(1)
  })
})
