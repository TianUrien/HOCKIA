import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import type { SearchClubResult as SearchClubResultType } from '@/hooks/useSearch'

interface SearchClubResultProps {
  result: SearchClubResultType
}

function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
}

export function SearchClubResult({ result }: SearchClubResultProps) {
  const clubPath = result.claimed_profile_id
    ? `/clubs/id/${result.claimed_profile_id}`
    : null

  const content = (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
        {result.avatar_url ? (
          <img src={result.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Shield className="w-6 h-6 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{result.club_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <img
            src={getFlagUrl(result.country_code)}
            alt=""
            className="w-4 h-3 object-cover rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-xs text-gray-500">{result.country_name}</span>
        </div>
      </div>
      {result.is_claimed && (
        <span className="text-[10px] font-medium text-[#8026FA] bg-[#8026FA]/10 px-2 py-0.5 rounded-full flex-shrink-0">
          On HOCKIA
        </span>
      )}
    </div>
  )

  if (clubPath) {
    return (
      <Link
        to={clubPath}
        className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      {content}
    </div>
  )
}
