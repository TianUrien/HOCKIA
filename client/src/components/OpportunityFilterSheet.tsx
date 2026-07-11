import Modal from './Modal'

const BENEFITS = ['housing', 'car', 'visa', 'flights', 'meals', 'job', 'insurance', 'education', 'bonuses', 'equipment']

interface FilterSheetProps {
  isOpen: boolean
  onClose: () => void
  location: string
  startDate: 'all' | 'immediate' | 'specific'
  benefits: string[]
  priority: 'all' | 'high' | 'medium' | 'low'
  onSetLocation: (location: string) => void
  onSetStartDate: (startDate: 'all' | 'immediate' | 'specific') => void
  onToggleBenefit: (benefit: string) => void
  onSetPriority: (priority: 'all' | 'high' | 'medium' | 'low') => void
  onClearSecondary: () => void
}

export default function OpportunityFilterSheet({
  isOpen,
  onClose,
  location,
  startDate,
  benefits,
  priority,
  onSetLocation,
  onSetStartDate,
  onToggleBenefit,
  onSetPriority,
  onClearSecondary,
}: FilterSheetProps) {
  const hasActive = location.trim() !== '' || startDate !== 'all' || benefits.length > 0 || priority !== 'all'

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="!max-w-lg sm:!max-w-lg !max-h-[85vh]" showClose={false}>
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">More Filters</h2>
          <div className="flex items-center gap-3">
            {hasActive && (
              <button
                onClick={onClearSecondary}
                className="text-sm text-hockia-primary hover:text-[#6b1de0] font-medium"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              Done
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => onSetLocation(e.target.value)}
              placeholder="City or Country"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-hockia-primary/30 focus:border-hockia-primary focus:outline-none transition-colors"
            />
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <div className="space-y-2">
              {([['all', 'All'], ['immediate', 'Immediate'], ['specific', 'Scheduled']] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={startDate === value}
                    onChange={() => onSetStartDate(value)}
                    className="w-4 h-4 accent-hockia-primary"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Benefits */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Benefits</label>
            <div className="grid grid-cols-2 gap-2">
              {BENEFITS.map((benefit) => (
                <label key={benefit} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={benefits.includes(benefit)}
                    onChange={() => onToggleBenefit(benefit)}
                    className="w-4 h-4 accent-hockia-primary rounded"
                  />
                  <span className="text-sm text-gray-700 capitalize">{benefit}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
            <div className="space-y-2">
              {([['all', 'All'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={priority === value}
                    onChange={() => onSetPriority(value)}
                    className="w-4 h-4 accent-hockia-primary"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Apply button (sticky bottom) */}
        <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-hockia-primary to-hockia-secondary hover:opacity-90 transition-opacity"
          >
            Apply Filters
          </button>
        </div>
      </div>
    </Modal>
  )
}
