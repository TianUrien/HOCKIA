/**
 * Community Questions Types
 * 
 * TypeScript definitions for the Community Q&A feature.
 */
import { tCommunity } from '@/i18n/ns/community'
import { lazyTextRecord, withLazyText } from '@/lib/opportunityLazyText'

// Question categories matching the database enum
export const QUESTION_CATEGORIES = [
  'trials_club_selection',
  'visas_moving_abroad',
  'scholarships_universities',
  'highlights_visibility',
  'training_performance',
  'coaching_development',
  'lifestyle_adaptation',
  'other',
] as const

export type QuestionCategory = typeof QUESTION_CATEGORIES[number]

// Human-readable labels for categories. Read through getters so each read
// follows the interface language (a constant is built before it is known).
export const CATEGORY_LABELS: Record<QuestionCategory, string> = lazyTextRecord({
  trials_club_selection: () => tCommunity('questions.categories.trialsClubSelection'),
  visas_moving_abroad: () => tCommunity('questions.categories.visasMovingAbroad'),
  scholarships_universities: () => tCommunity('questions.categories.scholarshipsUniversities'),
  highlights_visibility: () => tCommunity('questions.categories.highlightsVisibility'),
  training_performance: () => tCommunity('questions.categories.trainingPerformance'),
  coaching_development: () => tCommunity('questions.categories.coachingDevelopment'),
  lifestyle_adaptation: () => tCommunity('questions.categories.lifestyleAdaptation'),
  other: () => tCommunity('questions.categories.other'),
})

// Category badge colors (Tailwind classes)
export const CATEGORY_COLORS: Record<QuestionCategory, { bg: string; text: string }> = {
  trials_club_selection: { bg: 'bg-accent-blue-soft', text: 'text-accent-blue-ink' },
  visas_moving_abroad: { bg: 'bg-hockia-soft', text: 'text-hockia-primary' },
  scholarships_universities: { bg: 'bg-pink-100', text: 'text-pink-700' },
  highlights_visibility: { bg: 'bg-orange-100', text: 'text-orange-700' },
  training_performance: { bg: 'bg-red-100', text: 'text-red-700' },
  coaching_development: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  lifestyle_adaptation: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  other: { bg: 'bg-gray-100', text: 'text-gray-700' },
}

// Sort options for question list
export type QuestionSortOption = 'latest' | 'most_answered'

export const SORT_OPTIONS: { value: QuestionSortOption; label: string }[] = [
  withLazyText({ value: 'latest' as QuestionSortOption }, { label: () => tCommunity('questions.sort.latest') }),
  withLazyText({ value: 'most_answered' as QuestionSortOption }, { label: () => tCommunity('questions.sort.mostAnswered') }),
]

// Author info (simplified profile)
export interface QuestionAuthor {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
}

// Question item (list view)
export interface Question {
  id: string
  title: string
  body: string | null
  category: QuestionCategory
  answer_count: number
  created_at: string
  updated_at: string
  author: QuestionAuthor
}

// Question with answers (detail view)
export interface QuestionWithAnswers extends Question {
  answers: Answer[]
}

// Answer item
export interface Answer {
  id: string
  question_id: string
  body: string
  created_at: string
  updated_at: string
  author: QuestionAuthor
}

// API request types
export interface CreateQuestionInput {
  title: string
  body?: string
  category: QuestionCategory
}

export interface UpdateQuestionInput {
  title?: string
  body?: string
  category?: QuestionCategory
}

export interface CreateAnswerInput {
  question_id: string
  body: string
}

export interface UpdateAnswerInput {
  body: string
}

// API response types
export interface QuestionsListResponse {
  questions: Question[]
  hasMore: boolean
  totalCount: number
}

// Query params for fetching questions
export interface QuestionsQueryParams {
  category?: QuestionCategory | null
  sort?: QuestionSortOption
  search?: string | null
  limit?: number
  offset?: number
}
