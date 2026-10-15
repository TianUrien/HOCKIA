/**
 * DOM side of RouteMeta: writes title, canonical, og:url, description and
 * robots into <head> for a pathname. Kept out of the component file so the
 * component file exports only a component (react-refresh rule).
 */
import { DEFAULT_TITLE, resolveRouteMeta } from './routeMeta'

function upsert(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector)
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  el.setAttribute(attr, value)
}

export function applyRouteMeta(pathname: string): void {
  const meta = resolveRouteMeta(pathname)
  document.title = meta.title ?? DEFAULT_TITLE
  upsert('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', meta.canonical)
  upsert('meta[property="og:url"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:url'); return m }, 'content', meta.canonical)
  upsert('meta[name="twitter:url"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:url' }), 'content', meta.canonical)
  upsert('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', meta.description)
  upsert('meta[property="og:description"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:description'); return m }, 'content', meta.description)
  if (meta.title) {
    upsert('meta[property="og:title"]', () => { const m = document.createElement('meta'); m.setAttribute('property', 'og:title'); return m }, 'content', meta.title)
    upsert('meta[name="twitter:title"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:title' }), 'content', meta.title)
  }
  const robots = document.head.querySelector('meta[name="robots"]')
  if (meta.index) {
    robots?.remove()
  } else {
    upsert('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }), 'content', 'noindex, nofollow')
  }
}
