import { useCallback, useState } from 'react'
import { Palette, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getImageUrl } from '@/lib/imageUrl'
import { extractCrestColors } from '@/lib/crestColor'
import { CREST_PALETTE_VERSION, coverBackground } from '@/lib/crestPalette'
import { logger } from '@/lib/logger'

type Candidate = { kind: 'profile' | 'world_club'; id: string; name: string; crest_url: string }
type Done = Candidate & { color: string | null; palette: Parameters<typeof coverBackground>[0] }

/**
 * Crest palette backfill (Opportunities v2 foundations): lists club profiles
 * and directory clubs whose stored palette is missing, stale (new crest) or
 * older than the extractor, computes each on this machine with the SAME
 * extractor the app uses, and stores it through the admin RPCs. Runs here,
 * not in the DB, because the extractor is the client's canvas code.
 */
export function CrestPaletteBackfill() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [done, setDone] = useState<Done[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data, error: err } = await supabase.rpc('admin_crest_backfill_candidates', { p_version: CREST_PALETTE_VERSION })
    if (err) { setError(err.message); return }
    setCandidates((data ?? []) as Candidate[])
    setDone([])
  }, [])

  const run = useCallback(async () => {
    if (!candidates?.length) return
    setRunning(true)
    const results: Done[] = []
    for (const c of candidates) {
      const colors = await extractCrestColors(getImageUrl(c.crest_url, 'avatar-md') ?? c.crest_url)
      if (colors) {
        const args = { p_crest_url: c.crest_url, p_color: colors.color, p_palette: colors.palette }
        const { error: err } = c.kind === 'profile'
          ? await supabase.rpc('admin_set_crest_colors', { ...args, p_profile_id: c.id })
          : await supabase.rpc('admin_set_world_club_crest_colors', { ...args, p_world_club_id: c.id })
        if (err) logger.debug('[CrestPaletteBackfill] save failed', err)
      }
      results.push({ ...c, color: colors?.color ?? null, palette: colors?.palette ?? null })
      setDone([...results])
    }
    setRunning(false)
    setCandidates([])
  }, [candidates])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="crest-palette-backfill">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-purple-600" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Crest colours (v{CREST_PALETTE_VERSION})</h2>
            <p className="text-xs text-gray-500">Role covers use the club's crest colours. Lists clubs whose stored palette is missing or stale and computes it here.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className="w-4 h-4" /> Check
          </button>
          <button type="button" onClick={() => void run()} disabled={running || !candidates?.length} className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
            {running ? `Computing ${done.length}/${candidates?.length ?? 0}…` : `Compute ${candidates?.length ?? 0}`}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {candidates && !error && (
        <p className="mt-2 text-xs text-gray-500">
          {candidates.length === 0 && done.length === 0 ? 'Everything is current.' : `${candidates.length} to compute (${candidates.filter((c) => c.kind === 'profile').length} club profiles, ${candidates.filter((c) => c.kind === 'world_club').length} directory clubs).`}
        </p>
      )}
      {done.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {done.map((d) => (
            <li key={`${d.kind}-${d.id}`} className="flex items-center gap-3 rounded-lg border border-gray-200 p-2">
              <span className="h-10 w-16 shrink-0 rounded-md" style={{ background: coverBackground(d.palette) }} aria-hidden="true" />
              <img src={getImageUrl(d.crest_url, 'avatar-sm') ?? d.crest_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-900">{d.name}</span>
                <span className="block text-xs text-gray-500">{d.kind === 'profile' ? 'Club profile' : 'Directory club'} · {d.color ?? 'no usable crest'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
