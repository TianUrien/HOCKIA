import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

class ResizeObserver {
  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    // No-op to avoid recursive measurements in jsdom
    void target
  }

  unobserve() {
    // no-op for tests
  }

  disconnect() {
    // no-op for tests
  }
}

class IntersectionObserver {
  callback: IntersectionObserverCallback
  root: Element | Document | null = null
  rootMargin = '0px'
  thresholds = [0]

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }

  observe() {
    // ignore
  }

  unobserve() {
    // ignore
  }

  disconnect() {
    // ignore
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

// Provide minimal browser APIs that components rely on
globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver
globalThis.IntersectionObserver = IntersectionObserver as unknown as typeof globalThis.IntersectionObserver

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: query.includes('max-width') ? true : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
}

if (!window.scrollTo) {
  window.scrollTo = vi.fn()
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn()
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0)
}

if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (handle: number) => clearTimeout(handle)
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 80
})

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  value: 320
})

// @tanstack/virtual-core >= 3.14 measures the scroll element with
// clientWidth/clientHeight (it used offsetWidth/offsetHeight before); jsdom
// reports 0 for both, which leaves every virtual list empty.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 80
})

Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  value: 320
})
