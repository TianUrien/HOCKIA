/**
 * Minimal ES2022 shims for old WebViews — the TESTED REFERENCE for the
 * inline <script> in index.html, which is what actually ships.
 *
 * NOT imported by the app on purpose. Static ES imports are hoisted and the
 * vendor chunks evaluate BEFORE the entry module's own body, so importing
 * this from main.tsx would run it too late for any dependency that calls
 * .at() during module evaluation. The inline classic script in index.html
 * runs before the module graph starts; this file exists so the semantics
 * are unit-tested (src/__tests__/polyfills.test.ts) and the two stay in
 * lockstep — edit both together.
 *
 * WHY (Sentry JAVASCRIPT-REACT-8Y, 28 events): "TypeError: this.o.at is not
 * a function" thrown from the vendor chunk on Chrome Mobile WebView 91
 * (Android 11). Vite's default build target is ES2020 and it does NOT
 * polyfill ES2022 library methods, so `Array.prototype.at` — added in Chrome
 * 92 / Safari 15.4 — is simply absent on older system WebViews. Our own code
 * never calls `.at()`; a dependency does, and it takes the whole page down.
 *
 * Only what's needed, hand-written: pulling in core-js for two methods would
 * cost more bytes than the whole fix is worth. Guarded so modern engines
 * keep their native implementations.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const defineAt = (proto: any) => {
  if (typeof proto.at === 'function') return
  Object.defineProperty(proto, 'at', {
    configurable: true,
    writable: true,
    value: function at(this: { length: number; [i: number]: unknown }, n: number) {
      let i = Math.trunc(n) || 0
      if (i < 0) i += this.length
      if (i < 0 || i >= this.length) return undefined
      return this[i]
    },
  })
}

if (typeof Array !== 'undefined') defineAt(Array.prototype)
if (typeof String !== 'undefined') defineAt(String.prototype)
for (const T of [
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
]) {
  if (typeof T !== 'undefined') defineAt(T.prototype)
}

// Object.hasOwn — ES2022, same missing-in-old-WebView class, common in deps.
if (typeof (Object as any).hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k),
  })
}

export {}
