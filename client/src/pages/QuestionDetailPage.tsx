/**
 * QuestionDetailPage
 * 
 * Full-page view for a single question with its answers.
 * Allows users to read, answer, edit, and delete content.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, MessageCircle, MoreVertical, Pencil, Trash2, LogIn } from 'lucide-react'
import { Header, Avatar, RoleBadge } from '@/components'
import Breadcrumbs from '@/components/Breadcrumbs'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useQuestionDetail } from '@/hooks/useQuestions'
import { useAuthStore } from '@/lib/auth'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/questions'
import { formatDistanceToNow } from 'date-fns'
import type { Answer } from '@/types/questions'

export default function QuestionDetailPage() {
  const { questionId } = useParams<{ questionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [answerText, setAnswerText] = useState('')
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false)
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null)
  const [editAnswerText, setEditAnswerText] = useState('')
  const [showQuestionMenu, setShowQuestionMenu] = useState(false)
  const [answerMenuId, setAnswerMenuId] = useState<string | null>(null)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)

  const {
    question,
    isLoading,
    error,
    createAnswer,
    updateAnswer,
    deleteAnswer,
    deleteQuestion,
  } = useQuestionDetail(questionId)

  const handleSubmitAnswer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!answerText.trim() || !questionId) return

    setIsSubmittingAnswer(true)
    const result = await createAnswer({
      question_id: questionId,
      body: answerText.trim(),
    })
    setIsSubmittingAnswer(false)

    if (result) {
      setAnswerText('')
    }
  }

  const handleEditAnswer = useCallback((answer: Answer) => {
    setEditingAnswerId(answer.id)
    setEditAnswerText(answer.body)
    setAnswerMenuId(null)
  }, [])

  const handleSaveAnswerEdit = async () => {
    if (!editingAnswerId || !editAnswerText.trim()) return

    const success = await updateAnswer(editingAnswerId, { body: editAnswerText.trim() })
    if (success) {
      setEditingAnswerId(null)
      setEditAnswerText('')
    }
  }

  const handleCancelAnswerEdit = () => {
    setEditingAnswerId(null)
    setEditAnswerText('')
  }

  const handleDeleteAnswer = async (answerId: string) => {
    if (!confirm('Are you sure you want to delete this answer?')) return
    setAnswerMenuId(null)
    await deleteAnswer(answerId)
  }

  const handleDeleteQuestion = async () => {
    if (!confirm('Are you sure you want to delete this question? This action cannot be undone.')) return
    setShowQuestionMenu(false)
    const success = await deleteQuestion()
    if (success) {
      navigate('/community/questions')
    }
  }

  // Scroll to and focus answer textarea when navigating with #answer
  useEffect(() => {
    if (location.hash === '#answer' && !isLoading && question) {
      setTimeout(() => {
        answerTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        answerTextareaRef.current?.focus()
      }, 100)
    }
  }, [location.hash, isLoading, question])

  const isQuestionAuthor = user?.id === question?.author.id

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-3xl mx-auto px-4 md:px-6 pt-24 pb-12">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-24 mb-6" />
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="h-8 bg-gray-200 rounded w-3/4 mb-4" />
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-6" />
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-full" />
                <div className="h-4 bg-gray-200 rounded w-5/6" />
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (error || !question) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-3xl mx-auto px-4 md:px-6 pt-24 pb-12">
          <Link
            to="/community/questions"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Questions
          </Link>
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Question not found</h2>
            <p className="text-gray-500">This question may have been deleted or doesn't exist.</p>
          </div>
        </main>
      </div>
    )
  }

  const categoryColors = CATEGORY_COLORS[question.category]
  const categoryLabel = CATEGORY_LABELS[question.category]
  const timeAgo = formatDistanceToNow(new Date(question.created_at), { addSuffix: true })

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-3xl mx-auto px-4 md:px-6 pt-24 pb-12">
        <Breadcrumbs
          className="mb-6"
          items={[
            { label: 'Community', to: '/community' },
            { label: 'Questions', to: '/community/questions' },
            { label: question.title },
          ]}
        />

        {/* Question card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 relative">
          {/* Question menu (author only) */}
          {isQuestionAuthor && (
            <div className="absolute top-4 right-4">
              <button
                onClick={() => setShowQuestionMenu(!showQuestionMenu)}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                aria-label="Question options"
              >
                <MoreVertical className="w-5 h-5 text-gray-500" />
              </button>
              {showQuestionMenu && (
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                  <button
                    onClick={handleDeleteQuestion}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Question
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Category badge */}
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${categoryColors.bg} ${categoryColors.text} mb-3`}>
            {categoryLabel}
          </span>

          {/* Title */}
          <h1 className="text-2xl font-bold text-gray-900 mb-4 pr-8">
            {question.title}
          </h1>

          {/* Body */}
          {question.body && (
            <p className="text-gray-700 whitespace-pre-wrap mb-6">
              {question.body}
            </p>
          )}

          {/* Author info */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
            <Link to={`/members/id/${question.author.id}`} className="shrink-0">
              <Avatar
                src={question.author.avatar_url}
                alt={question.author.full_name || 'User'}
                size="md"
                className="w-10 h-10"
              />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  to={`/members/id/${question.author.id}`}
                  className="font-medium text-gray-900 hover:text-purple-600 transition-colors truncate"
                >
                  {question.author.full_name || 'Unknown'}
                </Link>
                <RoleBadge role={question.author.role} className="px-1.5 py-0.5 text-[10px] shrink-0" />
              </div>
              <p className="text-sm text-gray-500">
                Asked {timeAgo}
              </p>
            </div>
          </div>
        </div>

        {/* Answers section */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            {question.answer_count} {question.answer_count === 1 ? 'Answer' : 'Answers'}
          </h2>

          {question.answers.length > 0 ? (
            <div className="space-y-4">
              {question.answers.map((answer) => {
                const isAnswerAuthor = user?.id === answer.author.id
                const answerTimeAgo = formatDistanceToNow(new Date(answer.created_at), { addSuffix: true })

                return (
                  <div
                    key={answer.id}
                    className="bg-white rounded-xl border border-gray-200 p-5 relative"
                  >
                    {/* Answer menu (author only) */}
                    {isAnswerAuthor && editingAnswerId !== answer.id && (
                      <div className="absolute top-3 right-3">
                        <button
                          onClick={() => setAnswerMenuId(answerMenuId === answer.id ? null : answer.id)}
                          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                          aria-label="Answer options"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-500" />
                        </button>
                        {answerMenuId === answer.id && (
                          <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                            <button
                              onClick={() => handleEditAnswer(answer)}
                              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                              <Pencil className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteAnswer(answer.id)}
                              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {editingAnswerId === answer.id ? (
                      // Edit mode
                      <div>
                        <textarea
                          value={editAnswerText}
                          onChange={(e) => setEditAnswerText(e.target.value)}
                          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-purple-500 focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none"
                          rows={4}
                          maxLength={1500}
                          aria-label="Edit your answer"
                          autoCapitalize="sentences"
                          spellCheck
                        />
                        <div className="flex justify-end gap-2 mt-3">
                          <button
                            onClick={handleCancelAnswerEdit}
                            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveAnswerEdit}
                            disabled={!editAnswerText.trim()}
                            className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <>
                        <p className="text-gray-700 whitespace-pre-wrap pr-8">
                          {answer.body}
                        </p>
                        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                          <Link to={`/members/id/${answer.author.id}`} className="shrink-0">
                            <Avatar
                              src={answer.author.avatar_url}
                              alt={answer.author.full_name || 'User'}
                              size="sm"
                              className="w-8 h-8"
                            />
                          </Link>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/members/id/${answer.author.id}`}
                                className="text-sm font-medium text-gray-900 hover:text-purple-600 transition-colors truncate"
                              >
                                {answer.author.full_name || 'Unknown'}
                              </Link>
                              <RoleBadge role={answer.author.role} className="px-1.5 py-0.5 text-[10px] shrink-0" />
                            </div>
                            <p className="text-xs text-gray-500">{answerTimeAgo}</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
              <p className="text-gray-500">No answers yet. Be the first to answer!</p>
            </div>
          )}
        </div>

        {/* Answer form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Answer</h3>
          {user ? (
            <form onSubmit={handleSubmitAnswer}>
              <textarea
                ref={answerTextareaRef}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Share your knowledge or experience..."
                rows={5}
                maxLength={1500}
                autoCapitalize="sentences"
                spellCheck
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-purple-500 focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-400">
                  {answerText.length}/1,500
                </span>
                <button
                  type="submit"
                  disabled={!answerText.trim() || isSubmittingAnswer}
                  className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSubmittingAnswer ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Posting...
                    </>
                  ) : (
                    'Post Answer'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-center py-6">
              <p className="text-gray-600 mb-4">Sign in to share your answer with the community.</p>
              <button
                onClick={() => setShowSignInPrompt(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity"
              >
                <LogIn className="w-4 h-4" />
                Sign in to Answer
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to answer"
        message="Sign in or create a free PLAYR account to share your knowledge with the field hockey community."
      />
    </div>
  )
}
