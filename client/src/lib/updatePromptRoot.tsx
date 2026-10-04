import { createRoot, type Root } from 'react-dom/client'
import UpdatePrompt from '@/components/UpdatePrompt'

/**
 * Renders the update prompt in its own root, outside the app tree, so it can
 * appear before the app has mounted and survives route changes. Each call
 * re-mounts it (a new waiting version re-shows a dismissed prompt).
 */
let root: Root | null = null
let shown = 0

export function showUpdatePrompt(apply: () => void): void {
  if (typeof document === 'undefined') return
  let container = document.getElementById('update-prompt-root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'update-prompt-root'
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  shown += 1
  root.render(<UpdatePrompt key={shown} onReload={apply} />)
}
