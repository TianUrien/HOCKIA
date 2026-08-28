/**
 * ShortLinksPanel — mint and read app.inhockia.com/l/<code> links.
 *
 * Each row is one link: where it points, the utm set it carries, the channel
 * that utm normalizes to (same registry as the acquisition report), clicks,
 * and the signups whose attribution names this link. Codes are permanent —
 * a link is retired with the toggle, never deleted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Link2, Pencil, Plus } from 'lucide-react'
import { logger } from '@/lib/logger'
import { normalizeAttribution } from '@/lib/attributionRules'
import { displayGroup, displaySource } from '@/lib/attributionLabels'
import { SHORT_LINK_CODE_RE, isValidDestination, suggestCode } from '@/lib/shortLinks'
import { listShortLinks, upsertShortLink, type ShortLinkInput, type ShortLinkRow } from '../api/shortLinksApi'

const EMPTY: ShortLinkInput = { code: '', label: '', destination: '/', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', is_active: true }

/** Active first, busiest first, then by label — seed order means nothing to a reader. */
function sortRows(rows: ShortLinkRow[]): ShortLinkRow[] {
  return [...rows].sort((a, b) =>
    Number(b.is_active) - Number(a.is_active) || b.click_count - a.click_count || a.label.localeCompare(b.label))
}

function destinationLabel(dest: string): string {
  if (dest === 'store') return 'App Store / Play (by device)'
  return dest
}

export function ShortLinksPanel() {
  const [rows, setRows] = useState<ShortLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ShortLinkInput | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.inhockia.com'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(sortRows(await listShortLinks()))
      setError(null)
    } catch (err) {
      logger.error('[ShortLinksPanel] load failed', err)
      setError('Could not load short links.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const startNew = () => { setForm(EMPTY); setIsNew(true); setFormError(null) }
  const startEdit = (r: ShortLinkRow) => {
    setForm({
      code: r.code, label: r.label, destination: r.destination, utm_source: r.utm_source,
      utm_medium: r.utm_medium ?? '', utm_campaign: r.utm_campaign ?? '', utm_content: r.utm_content ?? '', is_active: r.is_active,
    })
    setIsNew(false)
    setFormError(null)
  }

  const channel = useMemo(() => {
    if (!form?.utm_source.trim()) return null
    return normalizeAttribution(form.utm_source.trim().toLowerCase(), null)
  }, [form?.utm_source])

  const validate = (f: ShortLinkInput): string | null => {
    if (!f.label.trim()) return 'Give the link a label.'
    if (!SHORT_LINK_CODE_RE.test(f.code)) return 'Code: 2–32 characters, lowercase letters, digits and hyphens.'
    if (isNew && rows.some((r) => r.code === f.code)) return `"${f.code}" is already taken.`
    if (!isValidDestination(f.destination.trim())) return 'Destination must be an in-app path (/opportunities), an https:// URL, or "store".'
    if (!f.utm_source.trim()) return 'utm_source is what the report will attribute signups to — it is required.'
    return null
  }

  const save = async () => {
    if (!form) return
    const problem = validate(form)
    if (problem) { setFormError(problem); return }
    setSaving(true)
    try {
      await upsertShortLink({
        ...form,
        destination: form.destination.trim(),
        utm_source: form.utm_source.trim().toLowerCase(),
        utm_medium: form.utm_medium?.trim() || null,
        utm_campaign: form.utm_campaign?.trim() || null,
        utm_content: form.utm_content?.trim() || null,
      })
      setForm(null)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (r: ShortLinkRow) => {
    try {
      await upsertShortLink({
        code: r.code, label: r.label, destination: r.destination, utm_source: r.utm_source,
        utm_medium: r.utm_medium, utm_campaign: r.utm_campaign, utm_content: r.utm_content, utm_term: r.utm_term,
        is_active: !r.is_active,
      })
      await load()
    } catch (err) {
      logger.error('[ShortLinksPanel] toggle failed', err)
      setError('Could not update the link.')
    }
  }

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${origin}/l/${code}`)
      setCopied(code)
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — the URL is visible in the row */
    }
  }

  const field = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5" data-testid="short-links-panel">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-900">Short links — tagged entry points</h3>
        </div>
        {!form && (
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
            data-testid="short-link-new"
          >
            <Plus className="w-3.5 h-3.5" /> New link
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Put <span className="font-mono">{origin.replace(/^https?:\/\//, '')}/l/&lt;code&gt;</span> in a bio, a post or on a
        QR. Every visit is counted, and a member who signs up after it is attributed to the link's channel. Retire a
        link with the toggle — codes are never reused.
      </p>

      {form && (
        <form
          className="mb-5 p-4 rounded-xl border border-purple-100 bg-purple-50/40 grid grid-cols-1 md:grid-cols-2 gap-3"
          onSubmit={(e) => { e.preventDefault(); void save() }}
          data-testid="short-link-form"
        >
          <label className="text-xs text-gray-600">
            Label
            <input
              className={field}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value, code: isNew && (!form.code || form.code === suggestCode(form.label)) ? suggestCode(e.target.value) : form.code })}
              placeholder="Instagram bio"
              autoFocus
            />
          </label>
          <label className="text-xs text-gray-600">
            Code {isNew ? '' : '(permanent)'}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400 font-mono shrink-0">/l/</span>
              <input
                className={`${field} font-mono ${isNew ? '' : 'bg-gray-100 text-gray-500'}`}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                readOnly={!isNew}
                placeholder="ig"
              />
            </div>
          </label>
          <label className="text-xs text-gray-600 md:col-span-2">
            Destination
            <input
              className={`${field} font-mono`}
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              placeholder="/  ·  /opportunities  ·  store  ·  https://…"
            />
            <span className="block mt-1 text-[11px] text-gray-400">
              "store" sends iPhones to the App Store and everyone else to Google Play with the tags in the install referrer.
            </span>
          </label>
          <label className="text-xs text-gray-600">
            utm_source
            <input className={field} value={form.utm_source} onChange={(e) => setForm({ ...form, utm_source: e.target.value })} placeholder="instagram" />
            {channel && (
              <span className={`block mt-1 text-[11px] ${channel.group === 'other' ? 'text-amber-600' : 'text-gray-500'}`} data-testid="short-link-channel">
                {channel.group === 'other'
                  ? `Not a known channel — will report as its own source "${channel.source}". Check the spelling.`
                  : `Reports as ${displaySource(channel.source)} · ${displayGroup(channel.group)}`}
              </span>
            )}
          </label>
          <label className="text-xs text-gray-600">
            utm_medium
            <input className={field} value={form.utm_medium ?? ''} onChange={(e) => setForm({ ...form, utm_medium: e.target.value })} placeholder="social" />
          </label>
          <label className="text-xs text-gray-600">
            utm_campaign
            <input className={field} value={form.utm_campaign ?? ''} onChange={(e) => setForm({ ...form, utm_campaign: e.target.value })} placeholder="bio" />
          </label>
          <label className="text-xs text-gray-600">
            utm_content <span className="text-gray-400">(optional)</span>
            <input className={field} value={form.utm_content ?? ''} onChange={(e) => setForm({ ...form, utm_content: e.target.value })} placeholder="story_aug" />
          </label>
          {formError && (
            <div className="md:col-span-2 flex items-center gap-2 text-xs text-amber-700" data-testid="short-link-form-error">
              <AlertTriangle className="w-3.5 h-3.5" /> {formError}
            </div>
          )}
          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg"
              data-testid="short-link-save"
            >
              {saving ? 'Saving…' : isNew ? 'Create link' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {loading && <div data-testid="short-links-loading" className="h-24 bg-gray-100 rounded-xl animate-pulse" />}
      {!loading && error && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-gray-500" data-testid="short-links-empty">No links yet.</div>
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3">Link</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Destination</th>
                <th className="py-2 pr-3 text-right">Clicks</th>
                <th className="py-2 pr-3 text-right">30d</th>
                <th className="py-2 pr-3 text-right">Signups</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className={`border-t border-gray-100 ${r.is_active ? '' : 'opacity-50'}`} data-testid={`short-link-row-${r.code}`}>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-gray-900">{r.label}</div>
                    <button
                      type="button"
                      onClick={() => void copy(r.code)}
                      className="inline-flex items-center gap-1 font-mono text-xs text-purple-700 hover:underline"
                      title="Copy link"
                      data-testid={`short-link-copy-${r.code}`}
                    >
                      /l/{r.code}
                      {copied === r.code ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-gray-400" />}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-gray-700">
                    {displaySource(r.normalized_source)}
                    {r.utm_campaign && <span className="text-gray-400"> · {r.utm_campaign}</span>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-gray-600 max-w-[16rem] truncate" title={r.destination}>{destinationLabel(r.destination)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.click_count}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{r.clicks_30d}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">{r.signups}</td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.is_active}
                      onClick={() => void toggleActive(r)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.is_active ? 'bg-purple-600' : 'bg-gray-300'}`}
                      title={r.is_active ? 'Retire this link' : 'Reactivate this link'}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${r.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => startEdit(r)} className="p-1 text-gray-400 hover:text-gray-700" title="Edit" aria-label={`Edit ${r.code}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {copied && <p className="sr-only" aria-live="polite">Link copied</p>}
    </div>
  )
}
