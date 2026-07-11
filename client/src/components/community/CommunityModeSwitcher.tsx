/**
 * CommunityModeSwitcher
 * 
 * A pill-style toggle for switching between People and Questions modes
 * in the Community section.
 */

import { useNavigate } from 'react-router-dom'

export type CommunityMode = 'people' | 'questions'

interface CommunityModeSwitcherProps {
  mode: CommunityMode
}

export function CommunityModeSwitcher({ mode }: CommunityModeSwitcherProps) {
  const navigate = useNavigate()

  const handleModeChange = (newMode: CommunityMode) => {
    if (newMode === mode) return
    
    if (newMode === 'people') {
      navigate('/community')
    } else {
      navigate('/community/questions')
    }
  }

  return (
    <div className="inline-flex items-center bg-white rounded-full p-1.5 shadow-sm border border-gray-200">
      <button
        onClick={() => handleModeChange('people')}
        className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200 min-w-[100px] ${
          mode === 'people'
            ? 'bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white shadow-md'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
        aria-pressed={mode === 'people' ? 'true' : 'false'}
      >
        People
      </button>
      <button
        onClick={() => handleModeChange('questions')}
        className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200 min-w-[100px] ${
          mode === 'questions'
            ? 'bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white shadow-md'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
        aria-pressed={mode === 'questions' ? 'true' : 'false'}
      >
        Questions
      </button>
    </div>
  )
}
