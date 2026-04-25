/**
 * Community Questions Types
 * 
 * TypeScript definitions for the Community Q&A feature.
 */

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

// Human-readable labels for categories
export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  trials_club_selection: 'Trials & Club Selection',
  visas_moving_abroad: 'Visas & Moving Abroad',
  scholarships_universities: 'Scholarships & Universities',
  highlights_visibility: 'Highlights & Visibility',
  training_performance: 'Training & Performance',
  coaching_development: 'Coaching & Development',
  lifestyle_adaptation: 'Lifestyle & Adaptation',
  other: 'Other / Not Sure',
}

// Category badge colors (Tailwind classes)
export const CATEGORY_COLORS: Record<QuestionCategory, { bg: string; text: string }> = {
  trials_club_selection: { bg: 'bg-blue-100', text: 'text-blue-700' },
  visas_moving_abroad: { bg: 'bg-amber-100', text: 'text-amber-700' },
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
  { value: 'latest', label: 'Latest' },
  { value: 'most_answered', label: 'Most Answered' },
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
