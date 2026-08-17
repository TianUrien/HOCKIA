import { describe, expect, it, beforeEach, afterEach } from 'vitest'

/**
 * Sentry JAVASCRIPT-REACT-8Y — `.at is not a function` on Chrome WebView 91.
 * The shim only installs when the method is absent, so to prove it WORKS we
 * have to remove the native one first (simulating the old engine), load the
 * module fresh, then restore.
 */
describe('polyfills — ES2022 shims for old WebViews', () => {
  const nativeArrayAt = Array.prototype.at
  const nativeStringAt = String.prototype.at
  const nativeHasOwn = (Object as unknown as { hasOwn?: unknown }).hasOwn

  beforeEach(() => {
    // Simulate Chrome 91: no .at, no Object.hasOwn.
    // @ts-expect-error — deliberately removing to test the shim
    delete Array.prototype.at
    // @ts-expect-error — deliberately removing to test the shim
    delete String.prototype.at
    // @ts-expect-error — deliberately removing to test the shim
    delete Object.hasOwn
  })

  afterEach(() => {
    Object.defineProperty(Array.prototype, 'at', { value: nativeArrayAt, configurable: true, writable: true })
    Object.defineProperty(String.prototype, 'at', { value: nativeStringAt, configurable: true, writable: true })
    Object.defineProperty(Object, 'hasOwn', { value: nativeHasOwn, configurable: true, writable: true })
  })

  it('installs Array.prototype.at with correct negative-index semantics', async () => {
    expect(typeof Array.prototype.at).toBe('undefined')
    await import('../lib/polyfills?fresh=' + Date.now())
    const arr = [10, 20, 30]
    expect(arr.at(0)).toBe(10)
    expect(arr.at(-1)).toBe(30)
    expect(arr.at(-3)).toBe(10)
    expect(arr.at(3)).toBeUndefined()
    expect(arr.at(-4)).toBeUndefined()
    // Non-integer index truncates, like the spec
    expect(arr.at(1.9)).toBe(20)
  })

  it('installs String.prototype.at and Object.hasOwn', async () => {
    await import('../lib/polyfills?fresh2=' + Date.now())
    expect('abc'.at(-1)).toBe('c')
    expect(Object.hasOwn({ k: 1 }, 'k')).toBe(true)
    expect(Object.hasOwn({}, 'toString')).toBe(false)
  })

  it('does NOT overwrite a native implementation when one exists', async () => {
    const marker = function () { return 'native' }
    Object.defineProperty(Array.prototype, 'at', { value: marker, configurable: true, writable: true })
    await import('../lib/polyfills?fresh3=' + Date.now())
    expect(Array.prototype.at).toBe(marker)
  })
})
