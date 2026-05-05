/**
 * ClubClaimStep - Club onboarding step for claiming/creating a club
 * 
 * Flow: Country → Region (if applicable) → Club → Leagues
 * 
 * Supports:
 * - Countries WITH regions (Argentina, Australia)
 * - Countries WITHOUT regions (England, Italy, Germany)
 * - Gender-independent league dropdowns (same options for men/women)
 * - Escape hatch: "None / Not applicable" and "Other"
 */

import { useState, useEffect, useMemo } from 'react'
import { Search, Building2, MapPin, Trophy, Plus, CheckCircle, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { Button } from '@/components'
import ClubClaimConfirmModal from './ClubClaimConfirmModal'

interface Region {
  id: number
  name: string
  slug: string
  country_id: number
  logical_id: string | null
}

interface League {
  id: number
  name: string
  tier: number | null
  logical_id: string | null
}

interface WorldClub {
  id: string
  club_id: string
  club_name: string
  is_claimed: boolean
  province_id: number | null
}

interface WorldCountry {
  country_id: number | null
  country_code: string | null
  country_name: string | null
  flag_emoji: string | null
  region: string | null
  has_regions: boolean | null
  total_leagues: number | null
  total_clubs: number | null
}

export interface ClubClaimResult {
  mode: 'claimed' | 'created' | 'skipped'
  worldClubId?: string
  clubName: string
  countryId: number
  countryName: string
  regionId?: number
  regionName?: string
  menLeagueId?: number | null
  womenLeagueId?: number | null
  menLeagueName?: string | null
  womenLeagueName?: string | null
}

interface ClubClaimStepProps {
  onComplete: (result: ClubClaimResult) => void
  onSkip: () => void
  profileId: string
}

export default function ClubClaimStep({ onComplete, onSkip, profileId }: ClubClaimStepProps) {
  // State - flow can skip 'region' step for countries without regions
  const [step, setStep] = useState<'country' | 'region' | 'club' | 'leagues'>('country')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Last-mile confirmation gate before the claim RPC fires. Prevents
  // accidental impersonation and puts the user on notice that
  // misrepresentation is a terms violation. The RPC itself does NOT
  // validate authority — the modal is the deterrent.
  const [showClaimConfirm, setShowClaimConfirm] = useState(false)
  
  // Data
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [leagues, setLeagues] = useState<League[]>([])
  const [clubs, setClubs] = useState<WorldClub[]>([])
  
  // Selections
  const [selectedCountry, setSelectedCountry] = useState<WorldCountry | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null)
  const [selectedClub, setSelectedClub] = useState<WorldClub | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [regionSkipped, setRegionSkipped] = useState(false)
  const [newClubName, setNewClubName] = useState('')
  const [menLeagueId, setMenLeagueId] = useState<number | null>(null)
  const [womenLeagueId, setWomenLeagueId] = useState<number | null>(null)
  
  // Search
  const [clubSearch, setClubSearch] = useState('')

  // Fetch countries with World directory on mount
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('world_countries_with_directory')
          .select('*')
          .order('country_name')

        if (error) throw error
        setCountries(data || [])
      } catch (err) {
        logger.error('[ClubClaimStep] Failed to fetch countries:', err)
        setError('Failed to load countries')
      } finally {
        setLoading(false)
      }
    }
    fetchCountries()
  }, [])

  // Handle country selection
  const handleCountrySelect = async (country: WorldCountry) => {
    if (!country.country_id) return
    setSelectedCountry(country)
    setLoading(true)
    setError('')
    
    try {
      if (country.has_regions) {
        // Fetch regions for this country
        const { data, error } = await supabase
          .from('world_provinces')
          .select('id, name, slug, country_id, logical_id')
          .eq('country_id', country.country_id)
          .order('display_order')

        if (error) throw error
        setRegions(data || [])
        setStep('region')
      } else {
        // No regions - fetch leagues directly for country
        await fetchLeaguesForLocation(country.country_id, null)
        // Also fetch clubs for this country
        const { data: clubsData, error: clubsError } = await supabase
          .from('world_clubs')
          .select('id, club_id, club_name, is_claimed, province_id')
          .eq('country_id', country.country_id)
          .is('province_id', null)
          .order('club_name')

        if (clubsError) throw clubsError
        setClubs(clubsData || [])
        setStep('club')
      }
    } catch (err) {
      logger.error('[ClubClaimStep] Failed to process country:', err)
      setError('Failed to load data for this country')
    } finally {
      setLoading(false)
    }
  }

  // Handle region selection
  const handleRegionSelect = async (region: Region) => {
    if (!selectedCountry?.country_id) return
    setSelectedRegion(region)
    setLoading(true)
    setError('')
    
    try {
      // Fetch leagues and clubs for this region
      await fetchLeaguesForLocation(selectedCountry.country_id, region.id)
      
      const { data: clubsData, error: clubsError } = await supabase
        .from('world_clubs')
        .select('id, club_id, club_name, is_claimed, province_id')
        .eq('province_id', region.id)
        .order('club_name')

      if (clubsError) throw clubsError
      setClubs(clubsData || [])
      setStep('club')
    } catch (err) {
      logger.error('[ClubClaimStep] Failed to process region:', err)
      setError('Failed to load clubs for this region')
    } finally {
      setLoading(false)
    }
  }

  // Handle region skip - "My region is not listed"
  const handleRegionSkip = async () => {
    if (!selectedCountry?.country_id) return
    setRegionSkipped(true)
    setSelectedRegion(null)
    setLoading(true)
    setError('')

    try {
      // Fetch country-level leagues (province_id IS NULL)
      // For Argentina this returns [] since all leagues are Buenos Aires-scoped — that's fine
      await fetchLeaguesForLocation(selectedCountry.country_id, null)

      // Go directly to create-new mode (no clubs to browse without a region)
      setSelectedClub(null)
      setIsCreatingNew(true)
      setStep('leagues')
    } catch (err) {
      logger.error('[ClubClaimStep] Failed to process region skip:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  // Fetch leagues using the RPC function
  const fetchLeaguesForLocation = async (countryId: number, regionId: number | null) => {
     
    const { data, error } = await supabase.rpc('get_leagues_for_location', {
      p_country_id: countryId,
      p_region_id: regionId ?? undefined
    }) as { data: League[] | null; error: Error | null }
    
    if (error) throw error
    setLeagues(data || [])
  }

  const handleClubSelect = (club: WorldClub) => {
    if (club.is_claimed) {
      setError('This club has already been claimed by another user.')
      return
    }
    setSelectedClub(club)
    setIsCreatingNew(false)
    setStep('leagues')
  }

  const handleCreateNew = () => {
    setSelectedClub(null)
    setIsCreatingNew(true)
    setStep('leagues')
  }

  const handleBack = () => {
    setError('')
    if (step === 'leagues') {
      if (regionSkipped) {
        // Came from region skip — go back to region selection
        setStep('region')
        setRegionSkipped(false)
        setIsCreatingNew(false)
        setNewClubName('')
        setMenLeagueId(null)
        setWomenLeagueId(null)
        setLeagues([])
        setClubs([])
      } else {
        setStep('club')
        setSelectedClub(null)
        setIsCreatingNew(false)
        setMenLeagueId(null)
        setWomenLeagueId(null)
      }
    } else if (step === 'club') {
      if (selectedCountry?.has_regions) {
        setStep('region')
        setSelectedRegion(null)
        setClubs([])
        setLeagues([])
      } else {
        setStep('country')
        setSelectedCountry(null)
        setClubs([])
        setLeagues([])
      }
    } else if (step === 'region') {
      setStep('country')
      setSelectedCountry(null)
      setRegions([])
    }
  }

  const handleConfirm = async () => {
    if (!selectedCountry?.country_id) return
    
    setLoading(true)
    setError('')
    
    try {
      if (selectedClub) {
        // Claim existing club
         
        const { data, error } = await supabase.rpc('claim_world_club', {
          p_world_club_id: selectedClub.id,
          p_profile_id: profileId,
          p_men_league_id: menLeagueId ?? undefined,
          p_women_league_id: womenLeagueId ?? undefined,
        }) as { data: { success: boolean; error?: string } | null; error: Error | null }

        if (error) throw error
        if (data && !data.success) {
          throw new Error(data.error || 'Failed to claim club')
        }

        const menLeague = leagues.find(l => l.id === menLeagueId)
        const womenLeague = leagues.find(l => l.id === womenLeagueId)

        onComplete({
          mode: 'claimed',
          worldClubId: selectedClub.id,
          clubName: selectedClub.club_name,
          countryId: selectedCountry.country_id,
          countryName: selectedCountry.country_name || '',
          regionId: selectedRegion?.id,
          regionName: selectedRegion?.name,
          menLeagueId,
          womenLeagueId,
          menLeagueName: menLeague?.name || null,
          womenLeagueName: womenLeague?.name || null,
        })
      } else if (isCreatingNew && newClubName.trim()) {
        // Create and claim new club
         
        const { data, error } = await supabase.rpc('create_and_claim_world_club', {
          p_club_name: newClubName.trim(),
          p_country_id: selectedCountry.country_id,
          p_province_id: selectedRegion?.id ?? undefined,
          p_profile_id: profileId,
          p_men_league_id: menLeagueId ?? undefined,
          p_women_league_id: womenLeagueId ?? undefined,
        }) as { data: { success: boolean; error?: string; club_id?: string } | null; error: Error | null }

        if (error) throw error
        if (data && !data.success) {
          throw new Error(data.error || 'Failed to create club')
        }

        const menLeague = leagues.find(l => l.id === menLeagueId)
        const womenLeague = leagues.find(l => l.id === womenLeagueId)

        onComplete({
          mode: 'created',
          worldClubId: data?.club_id,
          clubName: newClubName.trim(),
          countryId: selectedCountry.country_id,
          countryName: selectedCountry.country_name || '',
          regionId: selectedRegion?.id,
          regionName: selectedRegion?.name,
          menLeagueId,
          womenLeagueId,
          menLeagueName: menLeague?.name || null,
          womenLeagueName: womenLeague?.name || null,
        })
      }
    } catch (err) {
      logger.error('[ClubClaimStep] Claim/create failed:', err)
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setLoading(false)
    }
  }

  // Filtered clubs based on search
  const filteredClubs = useMemo(() => {
    if (!clubSearch.trim()) return clubs
    const query = clubSearch.toLowerCase()
    return clubs.filter(c => c.club_name.toLowerCase().includes(query))
  }, [clubs, clubSearch])

  // Determine progress steps based on whether country has regions
  const getProgressSteps = () => {
    if (regionSkipped) {
      return ['country', 'leagues']
    }
    if (!selectedCountry || selectedCountry.has_regions) {
      return ['country', 'region', 'club', 'leagues']
    }
    return ['country', 'club', 'leagues']
  }

  const progressSteps = getProgressSteps()
  const currentStepIndex = progressSteps.indexOf(step)

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {progressSteps.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === s 
                ? 'bg-[#8026FA] text-white' 
                : i < currentStepIndex
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-500'
            }`}>
              {i < currentStepIndex ? '✓' : i + 1}
            </div>
            {i < progressSteps.length - 1 && <div className={`w-8 h-0.5 ${
              i < currentStepIndex ? 'bg-green-500' : 'bg-gray-200'
            }`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Step 1: Country */}
      {step === 'country' && (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Where is your club located?</h2>
            <p className="text-gray-600">Select your country to find your club in our directory</p>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {countries.map(country => (
                <button
                  key={country.country_id ?? 0}
                  onClick={() => handleCountrySelect(country)}
                  className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-[#8026FA]/5 transition-all"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-200 flex-shrink-0">
                    <img
                      src={`https://flagcdn.com/w80/${(country.country_code ?? 'xx').toLowerCase()}.png`}
                      alt={`${country.country_name ?? 'Country'} flag`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        const span = document.createElement('span');
                        span.className = 'text-2xl';
                        span.textContent = country.flag_emoji || '🏳️';
                        const parent = target.parentElement!;
                        parent.replaceChildren(span);
                        parent.className = 'w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center';
                      }}
                    />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-medium text-gray-900">{country.country_name}</span>
                    <span className="text-sm text-gray-500 ml-2">
                      {country.total_leagues ?? 0} {country.total_leagues === 1 ? 'league' : 'leagues'}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </button>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={onSkip}
              className="w-full py-3 text-gray-600 hover:text-gray-900 text-sm"
            >
              My country is not listed - continue without claiming
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Region (only for countries with regions) */}
      {step === 'region' && selectedCountry && (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-2">
              <img
                src={`https://flagcdn.com/w40/${(selectedCountry.country_code ?? 'xx').toLowerCase()}.png`}
                alt=""
                className="w-5 h-4 object-cover rounded-sm"
              />
              <span>{selectedCountry.country_name}</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Select your region</h2>
            <p className="text-gray-600">Choose the region where your club is based</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {regions.map(region => (
                <button
                  key={region.id}
                  onClick={() => handleRegionSelect(region)}
                  className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-[#8026FA]/5 transition-all text-left"
                >
                  <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-blue-500" />
                  </div>
                  <span className="font-medium text-gray-900">{region.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={handleRegionSkip}
              className="w-full py-3 text-gray-600 hover:text-gray-900 text-sm"
            >
              My region is not listed – create a new club
            </button>
          </div>

          <button
            onClick={handleBack}
            className="w-full py-3 text-gray-600 hover:text-gray-900 text-sm"
          >
            ← Back to country selection
          </button>
        </div>
      )}

      {/* Step 3: Club selection */}
      {step === 'club' && (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-2">
              <img
                src={`https://flagcdn.com/w40/${(selectedCountry?.country_code ?? 'xx').toLowerCase()}.png`}
                alt=""
                className="w-5 h-4 object-cover rounded-sm"
              />
              <span>{selectedCountry?.country_name}</span>
              {selectedRegion && (
                <>
                  <span>/</span>
                  <span>{selectedRegion.name}</span>
                </>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Find your club</h2>
            <p className="text-gray-600">Search or scroll to find your club</p>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="search"
              placeholder="Search clubs..."
              value={clubSearch}
              onChange={(e) => setClubSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
              autoComplete="off"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {/* Club list */}
          <div className="max-h-64 overflow-y-auto space-y-2">
            {filteredClubs.length === 0 ? (
              <p className="text-center text-gray-500 py-4">No clubs found in this {selectedRegion ? 'region' : 'country'} yet</p>
            ) : (
              filteredClubs.map(club => (
                <button
                  key={club.id}
                  onClick={() => handleClubSelect(club)}
                  disabled={club.is_claimed}
                  className={`w-full flex items-center gap-3 p-4 bg-white border rounded-xl transition-all text-left ${
                    club.is_claimed 
                      ? 'border-gray-100 opacity-50 cursor-not-allowed' 
                      : 'border-gray-200 hover:border-[#8026FA] hover:bg-[#8026FA]/5'
                  }`}
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">{club.club_name}</span>
                    {club.is_claimed && (
                      <span className="ml-2 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Claimed</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Create new club button */}
          <button
            onClick={handleCreateNew}
            className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-600 hover:border-[#8026FA] hover:text-[#8026FA] transition-all"
          >
            <Plus className="w-5 h-5" />
            <span>My club is not listed - create new</span>
          </button>

          <button
            onClick={handleBack}
            className="w-full py-3 text-gray-600 hover:text-gray-900 text-sm"
          >
            ← Back to {selectedCountry?.has_regions ? 'region' : 'country'} selection
          </button>
        </div>
      )}

      {/* Step 4: Leagues */}
      {step === 'leagues' && (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-2">
              <img
                src={`https://flagcdn.com/w40/${(selectedCountry?.country_code ?? 'xx').toLowerCase()}.png`}
                alt=""
                className="w-5 h-4 object-cover rounded-sm"
              />
              <span>{selectedCountry?.country_name}</span>
              {selectedRegion && (
                <>
                  <span>/</span>
                  <span>{selectedRegion.name}</span>
                </>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {isCreatingNew ? 'Create your club' : `Claim ${selectedClub?.club_name}`}
            </h2>
            <p className="text-gray-600">
              {leagues.length > 0
                ? 'Select the leagues your club plays in'
                : 'Enter your club name to get started'}
            </p>
          </div>

          {/* New club name input */}
          {isCreatingNew && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Club Name
              </label>
              <input
                type="text"
                placeholder="Enter your club name"
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                required
              />
            </div>
          )}

          {/* Claimed club display */}
          {selectedClub && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedClub.club_name}</p>
                <p className="text-sm text-gray-600">You are claiming this club</p>
              </div>
              <CheckCircle className="w-6 h-6 text-green-500 ml-auto" />
            </div>
          )}

          {leagues.length > 0 ? (
            <>
              {/* Women's League */}
              <div>
                <label id="womens-league-label" className="block text-sm font-medium text-gray-700 mb-2">
                  <Trophy className="w-4 h-4 inline mr-1" />
                  Women's League
                </label>
                <p className="text-xs text-gray-500 mb-1.5">Select the league for your main women's team.</p>
                <select
                  aria-labelledby="womens-league-label"
                  value={womenLeagueId ?? ''}
                  onChange={(e) => setWomenLeagueId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                >
                  <option value="">None / Not applicable</option>
                  {leagues.map(league => (
                    <option key={league.id} value={league.id}>
                      {league.name}
                      {league.tier && ` (Tier ${league.tier})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Men's League */}
              <div>
                <label id="mens-league-label" className="block text-sm font-medium text-gray-700 mb-2">
                  <Trophy className="w-4 h-4 inline mr-1" />
                  Men's League
                </label>
                <p className="text-xs text-gray-500 mb-1.5">Select the league for your main men's team.</p>
                <select
                  aria-labelledby="mens-league-label"
                  value={menLeagueId ?? ''}
                  onChange={(e) => setMenLeagueId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                >
                  <option value="">None / Not applicable</option>
                  {leagues.map(league => (
                    <option key={league.id} value={league.id}>
                      {league.name}
                      {league.tier && ` (Tier ${league.tier})`}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-gray-500 text-center">
                If your club has multiple teams, you'll be able to add them later from your dashboard.
              </p>
            </>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm text-amber-800">
                No leagues are available for your region yet. You can add league information later from your club dashboard.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleBack}
              className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
            <Button
              onClick={() => setShowClaimConfirm(true)}
              disabled={loading || (isCreatingNew && !newClubName.trim())}
              className="flex-1 bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
            >
              {loading ? 'Processing...' : isCreatingNew ? 'Create & Claim Club' : 'Claim Club'}
            </Button>
          </div>
        </div>
      )}

      <ClubClaimConfirmModal
        isOpen={showClaimConfirm}
        onClose={() => { if (!loading) setShowClaimConfirm(false) }}
        onConfirm={async () => {
          await handleConfirm()
          // handleConfirm closes the step on success via onComplete; if
          // it errored the modal stays open so the user can read the
          // inline error and retry/cancel.
          setShowClaimConfirm(false)
        }}
        clubName={selectedClub?.club_name ?? newClubName.trim() ?? 'this club'}
        isCreating={isCreatingNew}
        loading={loading}
      />
    </div>
  )
}
