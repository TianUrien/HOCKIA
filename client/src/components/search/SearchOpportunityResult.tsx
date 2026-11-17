import { Link } from 'react-router-dom'
import { Briefcase, MapPin } from 'lucide-react'
import { positionLabel } from '@/lib/identity'
import type { SearchOpportunityResult as SearchOpportunityResultType } from '@/hooks/useSearch'
import { useEnumsT } from '@/i18n/ns/enums'
import { countryLabel } from '@/i18n/countryNames'

/** Separator between facts; punctuation, not copy. */
const DOT = '·'

interface SearchOpportunityResultProps {
  result: SearchOpportunityResultType
}

export function SearchOpportunityResult({ result }: SearchOpportunityResultProps) {
  const location = [result.location_city, countryLabel(result.location_country)]
    .filter(Boolean)
    .join(', ')

  const position = positionLabel(result.position)
  const tEnums = useEnumsT()
  // The type is a role token (player / coach): its label comes from the shared enums catalog.
  const typeLabel = result.opportunity_type === 'player' || result.opportunity_type === 'coach'
    ? tEnums(`role.${result.opportunity_type}`)
    : result.opportunity_type

  return (
    <Link
      to={`/opportunities/${result.opportunity_id}`}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
          {result.club_avatar_url ? (
            <img src={result.club_avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Briefcase className="w-5 h-5 text-gray-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{result.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-500 truncate">{result.club_name}</span>
            {location && (
              <>
                <span className="text-xs text-gray-500">{DOT}</span>
                <span className="text-xs text-gray-400 truncate flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {location}
                </span>
              </>
            )}
            {position && (
              <>
                <span className="text-xs text-gray-500">{DOT}</span>
                <span className="text-xs text-gray-400">{position}</span>
              </>
            )}
          </div>
        </div>
        <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex-shrink-0 capitalize">
          {typeLabel}
        </span>
      </div>
    </Link>
  )
}
