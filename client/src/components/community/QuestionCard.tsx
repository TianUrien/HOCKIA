/**
 * QuestionCard
 * 
 * Displays a question in the list view with title, category, answer count,
 * timestamp, and author info (avatar, name, role).
 */

import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle, PenLine } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/types/questions'
import type { Question } from '@/types/questions'
import { formatDistanceToNow } from 'date-fns'

interface QuestionCardProps {
  question: Question
}

export function QuestionCard({ question }: QuestionCardProps) {
  const navigate = useNavigate()
  const categoryColors = CATEGORY_COLORS[question.category]
  const categoryLabel = CATEGORY_LABELS[question.category]
  
  const timeAgo = formatDistanceToNow(new Date(question.created_at), { addSuffix: true })
    .replace('about ', '')
    .replace('less than a minute ago', 'just now')

  // Handle author click without navigating to question detail
  const handleAuthorClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/members/id/${question.author.id}`)
  }

  // Navigate directly to answer form on question page
  const handleAnswerClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/community/questions/${question.id}#answer`)
  }

  return (
    <Link
      to={`/community/questions/${question.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-purple-300 hover:shadow-md transition-all duration-200 group"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-purple-600 transition-colors line-clamp-2 mb-2">
            {question.title}
          </h3>
          
          {/* Category badge */}
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${categoryColors.bg} ${categoryColors.text}`}>
            {categoryLabel}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-3 border-t border-gray-100">
        {/* Answer count and time - row on mobile */}
        <div className="flex items-center justify-between sm:justify-start gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <MessageCircle className="w-4 h-4" />
            <span>
              {question.answer_count} {question.answer_count === 1 ? 'answer' : 'answers'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleAnswerClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#8026FA] bg-[#8026FA]/5 hover:bg-[#8026FA]/10 rounded-full transition-colors"
          >
            <PenLine className="w-3.5 h-3.5" />
            Answer
          </button>
          <span className="text-sm text-gray-400 sm:hidden">{timeAgo}</span>
        </div>

        {/* Author info */}
        <button
          onClick={handleAuthorClick}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <span className="text-sm text-gray-400 hidden sm:inline">{timeAgo}</span>
          <Avatar
            src={question.author.avatar_url}
            alt={question.author.full_name || 'User'}
            size="sm"
            className="w-7 h-7 shrink-0"
          />
          <span className="text-sm font-medium text-gray-700 truncate max-w-[100px] sm:max-w-[120px]">
            {question.author.full_name || 'Unknown'}
          </span>
          <RoleBadge role={question.author.role} className="px-1.5 py-0.5 text-[10px] shrink-0" />
        </button>
      </div>
    </Link>
  )
}
