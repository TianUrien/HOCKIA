/**
 * useQuestions Hook
 * 
 * React hook for Community Q&A functionality.
 * Handles fetching, creating, updating, and deleting questions and answers.
 */

import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import type {
  Question,
  QuestionWithAnswers,
  Answer,
  QuestionCategory,
  QuestionsQueryParams,
  CreateQuestionInput,
  UpdateQuestionInput,
} from '@/types/questions'

const PAGE_SIZE = 20

// Transform database row to Question type
function transformQuestion(row: Record<string, unknown>): Question {
  const author = row.author as Record<string, unknown> | null
  return {
    id: row.id as string,
    title: row.title as string,
    body: row.body as string | null,
    category: row.category as QuestionCategory,
    answer_count: row.answer_count as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    author: author ? {
      id: author.id as string,
      full_name: author.full_name as string | null,
      avatar_url: author.avatar_url as string | null,
      role: author.role as 'player' | 'coach' | 'club',
    } : {
      id: '',
      full_name: 'Unknown',
      avatar_url: null,
      role: 'player',
    },
  }
}

// Transform database row to Answer type
function transformAnswer(row: Record<string, unknown>): Answer {
  const author = row.author as Record<string, unknown> | null
  return {
    id: row.id as string,
    question_id: row.question_id as string,
    body: row.body as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    author: author ? {
      id: author.id as string,
      full_name: author.full_name as string | null,
      avatar_url: author.avatar_url as string | null,
      role: author.role as 'player' | 'coach' | 'club',
    } : {
      id: '',
      full_name: 'Unknown',
      avatar_url: null,
      role: 'player',
    },
  }
}

/**
 * Hook for managing the questions list
 */
export function useQuestions(params: QuestionsQueryParams = {}) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const { addToast } = useToastStore()

  const fetchQuestions = useCallback(async (offset = 0, append = false) => {
    try {
      if (!append) {
        setIsLoading(true)
      }
      setError(null)

      // Build query
      let query = supabase.from('community_questions')
        .select(`
          id,
          title,
          body,
          category,
          answer_count,
          created_at,
          updated_at,
          author:profiles!community_questions_author_id_fkey (
            id,
            full_name,
            avatar_url,
            role
          )
        `, { count: 'exact' })
        .is('deleted_at', null)

      // Category filter
      if (params.category) {
        query = query.eq('category', params.category)
      }

      // Search filter (title + body)
      if (params.search?.trim()) {
        const term = `%${params.search.trim()}%`
        query = query.or(`title.ilike.${term},body.ilike.${term}`)
      }

      // Sort order
      if (params.sort === 'most_answered') {
        query = query.order('answer_count', { ascending: false })
          .order('created_at', { ascending: false })
      } else {
        query = query.order('created_at', { ascending: false })
      }

      // Pagination
      const limit = params.limit || PAGE_SIZE
      query = query.range(offset, offset + limit - 1)

      const { data, error: fetchError, count } = await query

      if (fetchError) throw fetchError

      const newQuestions = (data || []).map((row: Record<string, unknown>) => transformQuestion(row))

      if (append) {
        setQuestions(prev => [...prev, ...newQuestions])
      } else {
        setQuestions(newQuestions)
      }

      setTotalCount(count || 0)
      setHasMore(newQuestions.length === limit)
    } catch (err) {
      logger.error('[useQuestions] Fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load questions')
    } finally {
      setIsLoading(false)
    }
  }, [params.category, params.sort, params.search, params.limit])

  // Initial fetch
  useEffect(() => {
    fetchQuestions(0, false)
  }, [fetchQuestions])

  // Load more
  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchQuestions(questions.length, true)
    }
  }, [fetchQuestions, isLoading, hasMore, questions.length])

  // Refresh
  const refresh = useCallback(() => {
    fetchQuestions(0, false)
  }, [fetchQuestions])

  // Create question
  const createQuestion = useCallback(async (input: CreateQuestionInput): Promise<Question | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        addToast('You must be logged in to ask a question', 'error')
        return null
      }

      const { data, error: insertError } = await supabase.from('community_questions')
        .insert({
          author_id: user.id,
          title: input.title.trim(),
          body: input.body?.trim() || null,
          category: input.category,
        })
        .select(`
          id,
          title,
          body,
          category,
          answer_count,
          created_at,
          updated_at,
          author:profiles!community_questions_author_id_fkey (
            id,
            full_name,
            avatar_url,
            role
          )
        `)
        .single()

      if (insertError) {
        if (insertError.message.includes('question_rate_limit_exceeded')) {
          addToast('You can only ask 3 questions per day. Please try again later.', 'error')
        } else {
          addToast('Failed to post question', 'error')
        }
        throw insertError
      }

      const newQuestion = transformQuestion(data as Record<string, unknown>)
      
      // Prepend to list
      setQuestions(prev => [newQuestion, ...prev])
      setTotalCount(prev => prev + 1)
      
      addToast('Question posted successfully!', 'success')
      return newQuestion
    } catch (err) {
      logger.error('[useQuestions] Create error:', err)
      return null
    }
  }, [addToast])

  // Update question
  const updateQuestion = useCallback(async (
    questionId: string,
    input: UpdateQuestionInput
  ): Promise<boolean> => {
    try {
      const updates: Record<string, unknown> = {}
      if (input.title !== undefined) updates.title = input.title.trim()
      if (input.body !== undefined) updates.body = input.body?.trim() || null
      if (input.category !== undefined) updates.category = input.category

      const { error: updateError } = await supabase.from('community_questions')
        .update(updates)
        .eq('id', questionId)

      if (updateError) {
        addToast('Failed to update question', 'error')
        throw updateError
      }

      // Update local state
      setQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, ...updates } as Question : q
      ))

      addToast('Question updated', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestions] Update error:', err)
      return false
    }
  }, [addToast])

  // Delete question (hard delete - RLS ensures only author can delete)
  const deleteQuestion = useCallback(async (questionId: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase.from('community_questions')
        .delete()
        .eq('id', questionId)

      if (deleteError) {
        logger.error('[useQuestions] Delete error:', deleteError)
        addToast('Failed to delete question', 'error')
        throw deleteError
      }

      // Remove from local state
      setQuestions(prev => prev.filter(q => q.id !== questionId))
      setTotalCount(prev => prev - 1)

      addToast('Question deleted', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestions] Delete error:', err)
      return false
    }
  }, [addToast])

  return {
    questions,
    isLoading,
    error,
    hasMore,
    totalCount,
    loadMore,
    refresh,
    createQuestion,
    updateQuestion,
    deleteQuestion,
  }
}

/**
 * Hook for fetching a single question with its answers
 */
export function useQuestionDetail(questionId: string | undefined) {
  const [question, setQuestion] = useState<QuestionWithAnswers | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { addToast } = useToastStore()

  const fetchQuestion = useCallback(async () => {
    if (!questionId) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Fetch question
      const { data: questionData, error: questionError } = await supabase.from('community_questions')
        .select(`
          id,
          title,
          body,
          category,
          answer_count,
          created_at,
          updated_at,
          author:profiles!community_questions_author_id_fkey (
            id,
            full_name,
            avatar_url,
            role
          )
        `)
        .eq('id', questionId)
        .is('deleted_at', null)
        .single()

      if (questionError) throw questionError

      // Fetch answers
      const { data: answersData, error: answersError } = await supabase.from('community_answers')
        .select(`
          id,
          question_id,
          body,
          created_at,
          updated_at,
          author:profiles!community_answers_author_id_fkey (
            id,
            full_name,
            avatar_url,
            role
          )
        `)
        .eq('question_id', questionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })

      if (answersError) throw answersError

      const transformedQuestion = transformQuestion(questionData as Record<string, unknown>)
      const transformedAnswers = (answersData || []).map((row: Record<string, unknown>) => 
        transformAnswer(row)
      )

      setQuestion({
        ...transformedQuestion,
        answers: transformedAnswers,
      })
    } catch (err) {
      logger.error('[useQuestionDetail] Fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load question')
    } finally {
      setIsLoading(false)
    }
  }, [questionId])

  // Initial fetch
  useEffect(() => {
    fetchQuestion()
  }, [fetchQuestion])

  // Create answer
  const createAnswer = useCallback(async (input: { question_id: string; body: string }): Promise<Answer | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        addToast('You must be logged in to answer', 'error')
        return null
      }

      const { data, error: insertError } = await supabase.from('community_answers')
        .insert({
          question_id: input.question_id,
          author_id: user.id,
          body: input.body.trim(),
        })
        .select(`
          id,
          question_id,
          body,
          created_at,
          updated_at,
          author:profiles!community_answers_author_id_fkey (
            id,
            full_name,
            avatar_url,
            role
          )
        `)
        .single()

      if (insertError) {
        if (insertError.message.includes('answer_rate_limit_exceeded')) {
          addToast('You can only post 10 answers per day. Please try again later.', 'error')
        } else {
          addToast('Failed to post answer', 'error')
        }
        throw insertError
      }

      const newAnswer = transformAnswer(data as Record<string, unknown>)

      // Add to local state
      setQuestion(prev => prev ? {
        ...prev,
        answer_count: prev.answer_count + 1,
        answers: [...prev.answers, newAnswer],
      } : null)

      addToast('Answer posted!', 'success')
      return newAnswer
    } catch (err) {
      logger.error('[useQuestionDetail] Create answer error:', err)
      return null
    }
  }, [addToast])

  // Update answer
  const updateAnswer = useCallback(async (
    answerId: string,
    input: { body: string }
  ): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase.from('community_answers')
        .update({ body: input.body.trim() })
        .eq('id', answerId)

      if (updateError) {
        addToast('Failed to update answer', 'error')
        throw updateError
      }

      // Update local state
      setQuestion(prev => prev ? {
        ...prev,
        answers: prev.answers.map(a => 
          a.id === answerId ? { ...a, body: input.body.trim() } : a
        ),
      } : null)

      addToast('Answer updated', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestionDetail] Update answer error:', err)
      return false
    }
  }, [addToast])

  // Delete answer
  const deleteAnswer = useCallback(async (answerId: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase.from('community_answers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', answerId)

      if (deleteError) {
        addToast('Failed to delete answer', 'error')
        throw deleteError
      }

      // Update local state
      setQuestion(prev => prev ? {
        ...prev,
        answer_count: Math.max(0, prev.answer_count - 1),
        answers: prev.answers.filter(a => a.id !== answerId),
      } : null)

      addToast('Answer deleted', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestionDetail] Delete answer error:', err)
      return false
    }
  }, [addToast])

  // Update question
  const updateQuestion = useCallback(async (input: UpdateQuestionInput): Promise<boolean> => {
    if (!questionId) return false

    try {
      const updates: Record<string, unknown> = {}
      if (input.title !== undefined) updates.title = input.title.trim()
      if (input.body !== undefined) updates.body = input.body?.trim() || null
      if (input.category !== undefined) updates.category = input.category

      const { error: updateError } = await supabase.from('community_questions')
        .update(updates)
        .eq('id', questionId)

      if (updateError) {
        addToast('Failed to update question', 'error')
        throw updateError
      }

      // Update local state
      setQuestion(prev => prev ? { ...prev, ...updates } as QuestionWithAnswers : null)

      addToast('Question updated', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestionDetail] Update question error:', err)
      return false
    }
  }, [questionId, addToast])

  // Delete question (hard delete - RLS ensures only author can delete)
  const deleteQuestion = useCallback(async (): Promise<boolean> => {
    if (!questionId) return false

    try {
      const { error: deleteError } = await supabase.from('community_questions')
        .delete()
        .eq('id', questionId)

      if (deleteError) {
        logger.error('[useQuestionDetail] Delete question error:', deleteError)
        addToast('Failed to delete question', 'error')
        throw deleteError
      }

      setQuestion(null)
      addToast('Question deleted', 'success')
      return true
    } catch (err) {
      logger.error('[useQuestionDetail] Delete question error:', err)
      return false
    }
  }, [questionId, addToast])

  return {
    question,
    isLoading,
    error,
    refresh: fetchQuestion,
    createAnswer,
    updateAnswer,
    deleteAnswer,
    updateQuestion,
    deleteQuestion,
  }
}
