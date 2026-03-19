/**
 * VacancyJsonLd - Structured data component for AI discoverability
 * 
 * Generates schema.org/JobPosting JSON-LD for vacancy pages.
 * This makes HOCKIA opportunities machine-readable for:
 * - Search engines (Google, Bing)
 * - AI assistants (ChatGPT, Claude, Siri, etc.)
 * - Job aggregators
 * 
 * @see https://schema.org/JobPosting
 * @see https://developers.google.com/search/docs/appearance/structured-data/job-posting
 */

import { useMemo } from 'react'
import type { Vacancy } from '@/lib/supabase'

interface ClubInfo {
  name: string
  logoUrl?: string | null
  location?: string | null
  league?: string | null
}

interface VacancyJsonLdProps {
  vacancy: Vacancy
  club: ClubInfo
}

interface JobPostingSchema {
  '@context': 'https://schema.org'
  '@type': 'JobPosting'
  title: string
  description: string
  datePosted: string
  validThrough?: string
  jobStartDate?: string
  employmentType?: string
  occupationalCategory?: string
  jobBenefits?: string
  qualifications?: string
  hiringOrganization: {
    '@type': 'SportsTeam'
    name: string
    logo?: string
    location?: string
  }
  jobLocation: {
    '@type': 'Place'
    address: {
      '@type': 'PostalAddress'
      addressLocality: string
      addressCountry: string
    }
  }
  url: string
  identifier?: {
    '@type': 'PropertyValue'
    name: string
    value: string
  }
}

/**
 * Maps HOCKIA position enum to human-readable category
 */
function formatPosition(position: string | null, gender: string | null): string {
  if (!position) return 'Field Hockey Player'
  
  const positionMap: Record<string, string> = {
    goalkeeper: 'Goalkeeper',
    defender: 'Defender',
    midfielder: 'Midfielder',
    forward: 'Forward',
  }
  
  const genderPrefix = gender === 'Women' ? "Women's" : gender === 'Men' ? "Men's" : ''
  const positionLabel = positionMap[position] || position
  
  return genderPrefix ? `${genderPrefix} ${positionLabel}` : positionLabel
}

/**
 * Maps HOCKIA benefits array to human-readable string
 */
function formatBenefits(benefits: string[], customBenefits: string[]): string | undefined {
  const benefitLabels: Record<string, string> = {
    housing: 'Housing provided',
    car: 'Car provided',
    visa: 'Visa sponsorship',
    flights: 'Flight allowance',
    meals: 'Meals included',
    job: 'Employment opportunity',
    insurance: 'Health insurance',
    education: 'Education support',
    bonuses: 'Performance bonuses',
    equipment: 'Equipment provided',
  }
  
  const allBenefits = [
    ...benefits.map(b => benefitLabels[b] || b),
    ...customBenefits,
  ].filter(Boolean)
  
  return allBenefits.length > 0 ? allBenefits.join(', ') : undefined
}

/**
 * Formats requirements array to human-readable string
 */
function formatRequirements(requirements: string[]): string | undefined {
  if (!requirements || requirements.length === 0) return undefined
  return requirements.join('. ')
}

/**
 * Creates a clean description from vacancy data
 */
function createDescription(vacancy: Vacancy, club: ClubInfo): string {
  const parts: string[] = []
  
  // Base description
  if (vacancy.description) {
    parts.push(vacancy.description)
  }
  
  // Add context if description is short
  if (!vacancy.description || vacancy.description.length < 100) {
    const position = formatPosition(vacancy.position, vacancy.gender)
    parts.unshift(`${club.name} is looking for a ${position} to join their team in ${vacancy.location_city}, ${vacancy.location_country}.`)
  }
  
  // Add duration if available
  if (vacancy.duration_text) {
    parts.push(`Duration: ${vacancy.duration_text}`)
  }
  
  return parts.join(' ')
}

export default function VacancyJsonLd({ vacancy, club }: VacancyJsonLdProps) {
  const jsonLd = useMemo<JobPostingSchema>(() => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://inhockia.com'
    
    return {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      
      // Core fields
      title: vacancy.title,
      description: createDescription(vacancy, club),
      datePosted: vacancy.published_at || vacancy.created_at,
      
      // Timing
      ...(vacancy.application_deadline && {
        validThrough: new Date(vacancy.application_deadline).toISOString(),
      }),
      ...(vacancy.start_date && {
        jobStartDate: vacancy.start_date,
      }),
      
      // Type and category
      employmentType: vacancy.opportunity_type === 'coach' ? 'CONTRACTOR' : 'FULL_TIME',
      occupationalCategory: formatPosition(vacancy.position, vacancy.gender),
      
      // Benefits and requirements
      ...(vacancy.benefits && vacancy.benefits.length > 0 && {
        jobBenefits: formatBenefits(vacancy.benefits, vacancy.custom_benefits || []),
      }),
      ...(vacancy.requirements && vacancy.requirements.length > 0 && {
        qualifications: formatRequirements(vacancy.requirements),
      }),
      
      // Hiring organization (the club)
      hiringOrganization: {
        '@type': 'SportsTeam',
        name: club.name,
        ...(club.logoUrl && { logo: club.logoUrl }),
        ...(club.location && { location: club.location }),
      },
      
      // Location
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: vacancy.location_city,
          addressCountry: vacancy.location_country,
        },
      },
      
      // Link back to HOCKIA
      url: `${baseUrl}/opportunities/${vacancy.id}`,
      
      // Identifier for deduplication
      identifier: {
        '@type': 'PropertyValue',
        name: 'HOCKIA Opportunity ID',
        value: vacancy.id,
      },
    }
  }, [vacancy, club])

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

/**
 * OpportunitiesListJsonLd - Aggregate structured data for the opportunities list page
 * 
 * Generates schema.org/ItemList JSON-LD for the opportunities listing.
 * This helps AI understand that this page contains multiple job postings.
 */
interface OpportunityListItem {
  id: string
  title: string
  position: string | null
  gender: string | null
  location_city: string
  location_country: string
}

interface OpportunitiesListJsonLdProps {
  opportunities: OpportunityListItem[]
  totalCount: number
}

interface ItemListSchema {
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  name: string
  description: string
  numberOfItems: number
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    url: string
    name: string
  }>
}

export function OpportunitiesListJsonLd({ opportunities, totalCount }: OpportunitiesListJsonLdProps) {
  const jsonLd = useMemo<ItemListSchema>(() => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://inhockia.com'
    
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Field Hockey Opportunities on HOCKIA',
      description: `Browse ${totalCount} open field hockey opportunities for players and coaches worldwide.`,
      numberOfItems: totalCount,
      itemListElement: opportunities.slice(0, 10).map((opp, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${baseUrl}/opportunities/${opp.id}`,
        name: opp.title,
      })),
    }
  }, [opportunities, totalCount])

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
