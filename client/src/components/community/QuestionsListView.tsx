/**
 * QuestionsListView
 * 
 * The Questions mode view for the Community page.
 * Displays list of questions with filtering and sorting.
 */

import { useState, useCallback, useRef } from 'react'
import { Plus, ChevronDown, Search, X } from 'lucide-react'
import { QuestionCard } from './QuestionCard'
import { AskQuestionModal } from './AskQuestionModal'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useQuestions } from '@/hooks/useQuestions'
import { useAuthStore } from '@/lib/auth'
import {
  QUESTION_CATEGORIES,
  CATEGORY_LABELS,
  SORT_OPTIONS,
} from '@/types/questions'
import type { QuestionCategory, QuestionSortOption, CreateQuestionInput } from '@/types/questions'

export function QuestionsListView() {
  const { user } = useAuthStore()
  const [selectedCategory, setSelectedCategory] = useState<QuestionCategory | null>(null)
  const [sortBy, setSortBy] = useState<QuestionSortOption>('latest')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Debounce search input (500ms)
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim() || null)
    }, 500)
  }, [])

  const clearSearch = useCallback(() => {
    setSearchInput('')
    setDebouncedSearch(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const {
    questions,
    isLoading,
    hasMore,
    loadMore,
    createQuestion,
  } = useQuestions({
    category: selectedCategory,
    sort: sortBy,
    search: debouncedSearch,
  })

  const handleCreateQuestion = useCallback(async (input: CreateQuestionInput) => {
    setIsSubmitting(true)
    const result = await createQuestion(input)
    setIsSubmitting(false)
    return result !== null
  }, [createQuestion])

  const handleAskQuestionClick = () => {
    if (!user) {
      setShowSignInPrompt(true)
    } else {
      setIsModalOpen(true)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Questions</h2>
          <p className="text-gray-600">Ask the field hockey world.</p>
        </div>
        <button
          onClick={handleAskQuestionClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity shadow-md whitespace-nowrap"
        >
          <Plus className="w-5 h-5" />
          Ask a Question
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search questions by keyword or topic..."
          className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
        />
        {searchInput && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-8">
        {/* Category dropdown */}
        <div className="relative">
          <select
            value={selectedCategory || ''}
            onChange={(e) => setSelectedCategory(e.target.value as QuestionCategory || null)}
            className="appearance-none bg-white border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 cursor-pointer min-w-[180px]"
            title="Filter by category"
          >
            <option value="">All Categories</option>
            {QUESTION_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as QuestionSortOption)}
            className="appearance-none bg-white border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 cursor-pointer min-w-[140px]"
            title="Sort questions"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        </div>
      </div>

      {/* Questions list */}
      {isLoading ? (
        // Loading skeleton
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-4" />
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="h-4 bg-gray-200 rounded w-20" />
                <div className="flex items-center gap-3">
                  <div className="h-4 bg-gray-200 rounded w-16" />
                  <div className="w-7 h-7 bg-gray-200 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : questions.length === 0 ? (
        // Empty state
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <div className="max-w-sm mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-100 flex items-center justify-center">
              <Plus className="w-8 h-8 text-purple-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {debouncedSearch
                ? 'No questions found'
                : selectedCategory
                  ? 'No questions in this category'
                  : 'No questions yet'}
            </h3>
            <p className="text-gray-500 mb-6">
              {debouncedSearch
                ? 'Try different keywords or clear your search.'
                : selectedCategory
                  ? 'Be the first to ask a question in this category!'
                  : 'Start the conversation by asking the first question.'}
            </p>
            <button
              onClick={handleAskQuestionClick}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-5 h-5" />
              Ask a Question
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Questions grid */}
          <div className="space-y-4">
            {questions.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={loadMore}
                className="px-8 py-3 rounded-lg bg-white border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-400 transition-all"
              >
                Load More Questions
              </button>
            </div>
          )}
        </>
      )}

      {/* Ask Question Modal */}
      <AskQuestionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateQuestion}
        isSubmitting={isSubmitting}
      />

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to ask a question"
        message="Sign in or create a free PLAYR account to ask questions to the field hockey community."
      />
    </div>
  )
}
