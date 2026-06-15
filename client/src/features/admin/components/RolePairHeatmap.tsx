/**
 * RolePairHeatmap — directional who-messages-whom matrix.
 *
 * Rows = sender role, columns = recipient role; cell = message count with
 * colour intensity (and conversation count in the tooltip). Directional:
 * club→player and player→club are distinct cells, which is the whole point —
 * it reveals whether the recruiter side actually reaches out.
 */

import type { RolePairMatrixData } from '../types'

const ROLE_ORDER = ['club', 'coach', 'player', 'brand', 'umpire']
const ROLE_LABELS: Record<string, string> = {
  club: 'Club',
  coach: 'Coach',
  player: 'Player',
  brand: 'Brand',
  umpire: 'Umpire',
  unknown: 'Unknown',
}

interface RolePairHeatmapProps {
  data: RolePairMatrixData[]
  loading?: boolean
}

export function RolePairHeatmap({ data, loading = false }: RolePairHeatmapProps) {
  if (loading) {
    return <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
  }
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No messages in this period</p>
  }

  const lookup = new Map<string, RolePairMatrixData>()
  let max = 0
  for (const row of data) {
    lookup.set(`${row.sender_role}|${row.recipient_role}`, row)
    if (row.message_count > max) max = row.message_count
  }

  // Axis = the known roles that actually appear (either side), plus 'unknown' last.
  const present = (r: string) => data.some((d) => d.sender_role === r || d.recipient_role === r)
  const axis = ROLE_ORDER.filter(present)
  if (data.some((d) => d.sender_role === 'unknown' || d.recipient_role === 'unknown')) {
    axis.push('unknown')
  }

  const cellClass = (count: number) => {
    if (count === 0) return 'bg-gray-50 text-gray-300'
    const intensity = max > 0 ? count / max : 0
    if (intensity > 0.66) return 'bg-purple-600 text-white'
    if (intensity > 0.33) return 'bg-purple-400 text-white'
    return 'bg-purple-100 text-purple-900'
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-[11px] text-gray-400 font-medium p-2 text-left whitespace-nowrap">
              Sender ↓ / Recipient →
            </th>
            {axis.map((r) => (
              <th key={r} className="text-xs text-gray-500 font-medium p-2">
                {ROLE_LABELS[r] ?? r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axis.map((sender) => (
            <tr key={sender}>
              <td className="text-xs text-gray-500 font-medium p-2 whitespace-nowrap">
                {ROLE_LABELS[sender] ?? sender}
              </td>
              {axis.map((recipient) => {
                const cell = lookup.get(`${sender}|${recipient}`)
                const count = cell?.message_count ?? 0
                return (
                  <td
                    key={recipient}
                    className={`text-center text-sm font-medium rounded-md w-14 h-12 ${cellClass(count)}`}
                    title={
                      cell
                        ? `${ROLE_LABELS[sender] ?? sender} → ${ROLE_LABELS[recipient] ?? recipient}: ${cell.message_count} messages across ${cell.conversation_count} conversations`
                        : `${ROLE_LABELS[sender] ?? sender} → ${ROLE_LABELS[recipient] ?? recipient}: none`
                    }
                  >
                    {count > 0 ? count : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
