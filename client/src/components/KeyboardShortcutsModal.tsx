import Modal from './Modal'
import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts'

interface KeyboardShortcutsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg">
      <div className="p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">
          Keyboard Shortcuts
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          Navigate HOCKIA faster with your keyboard
        </p>

        <div className="space-y-5">
          {KEYBOARD_SHORTCUTS.map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {group.category}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50"
                  >
                    <span className="text-sm text-gray-700">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, ki) => (
                        <span key={ki} className="inline-flex items-center">
                          <kbd className="min-w-[28px] text-center px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded-md shadow-sm">
                            {key}
                          </kbd>
                          {ki < shortcut.keys.length - 1 && (
                            <span className="mx-1 text-xs text-gray-400">then</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
          Shortcuts are disabled when typing in forms or when modals are open
        </p>
      </div>
    </Modal>
  )
}
