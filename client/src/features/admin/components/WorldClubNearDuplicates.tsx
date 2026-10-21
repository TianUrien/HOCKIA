import { useCallback, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type NearDuplicatePair = {
  a_id: string
  a_name: string
  b_id: string
  b_name: string
  country_name: string
  similarity: number
  a_is_claimed: boolean
  b_is_claimed: boolean
}

/**
 * Directory clean-up (2026-10-21): pairs of clubs in the same country whose
 * names look like the same club (trigram similarity, or equal once
 * punctuation and "hockey", "club", "hc", "fc" are removed). Read-only and on
 * demand: the RPC (admin_world_club_near_duplicates) scans the directory, so
 * it only runs when an admin presses Check. Merging is manual for now.
 */
export function WorldClubNearDuplicates() {
  const [pairs, setPairs] = useState<NearDuplicatePair[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('admin_world_club_near_duplicates', { p_threshold: 0.6, p_limit: 200 })
    setLoading(false)
    if (err) { setError(err.message); return }
    setPairs((data ?? []) as NearDuplicatePair[])
  }, [])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="world-club-near-duplicates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Copy className="w-5 h-5 text-purple-600" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Possible duplicate clubs</h2>
            <p className="text-xs text-gray-500">Clubs in the same country with very similar names. Merging is manual for now.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Checking…' : 'Check'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {pairs && !error && pairs.length === 0 && (
        <p className="mt-2 text-xs text-gray-500">No likely duplicates found.</p>
      )}
      {pairs && !error && pairs.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-4 font-medium">Club</th>
                <th className="py-1.5 pr-4 font-medium">Looks like</th>
                <th className="py-1.5 pr-4 font-medium">Country</th>
                <th className="py-1.5 font-medium">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={`${p.a_id}-${p.b_id}`} className="border-t border-gray-100">
                  <td className="py-1.5 pr-4 text-gray-900">{p.a_name}{p.a_is_claimed && <span className="ml-1.5 text-xs text-gray-500">(claimed)</span>}</td>
                  <td className="py-1.5 pr-4 text-gray-900">{p.b_name}{p.b_is_claimed && <span className="ml-1.5 text-xs text-gray-500">(claimed)</span>}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{p.country_name}</td>
                  <td className="py-1.5 text-gray-600">{Math.round(p.similarity * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">{pairs.length} pair{pairs.length === 1 ? '' : 's'}{pairs.length >= 200 ? ' (first 200)' : ''}.</p>
        </div>
      )}
    </div>
  )
}
