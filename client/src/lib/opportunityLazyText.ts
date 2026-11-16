/**
 * Copy inside exported constants (status labels, benefit tiles, filter
 * chips). A constant is built once, when its module loads, before the
 * interface language is known, so the text is read through a getter each
 * time it is used. Consumers keep reading `TABLE.key` / `item.label`.
 */

/** `base` plus enumerable, read-only properties whose text is computed on every read. */
/* @__NO_SIDE_EFFECTS__ */
export function withLazyText<B extends object, K extends string>(base: B, texts: Record<K, () => string>): B & Readonly<Record<K, string>> {
  for (const key of Object.keys(texts) as K[]) {
    Object.defineProperty(base, key, { enumerable: true, configurable: false, get: texts[key] })
  }
  return base as B & Readonly<Record<K, string>>
}

/** A record whose every value is computed on every read. */
/* @__NO_SIDE_EFFECTS__ */
export function lazyTextRecord<K extends string>(texts: Record<K, () => string>): Record<K, string> {
  return withLazyText({}, texts) as Record<K, string>
}
