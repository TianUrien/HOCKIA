import { useState } from 'react'
import {
  Heading1,
  AlignLeft,
  CreditCard,
  UserCircle,
  MousePointerClick,
  Minus,
  StickyNote,
  MessageSquare,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  FileText,
} from 'lucide-react'
import type { EmailContentBlock } from '../types'

const BLOCK_TYPES = [
  { type: 'heading', label: 'Heading', icon: Heading1 },
  { type: 'paragraph', label: 'Paragraph', icon: AlignLeft },
  { type: 'card', label: 'Card', icon: CreditCard },
  { type: 'user_card', label: 'User Card', icon: UserCircle },
  { type: 'button', label: 'Button', icon: MousePointerClick },
  { type: 'divider', label: 'Divider', icon: Minus },
  { type: 'footnote', label: 'Footnote', icon: FileText },
  { type: 'note', label: 'Note', icon: StickyNote },
  { type: 'conversation_list', label: 'Conversations', icon: MessageSquare },
] as const

interface EmailBlockEditorProps {
  blocks: EmailContentBlock[]
  onChange: (blocks: EmailContentBlock[]) => void
}

export function EmailBlockEditor({ blocks, onChange }: EmailBlockEditorProps) {
  const [showAddMenu, setShowAddMenu] = useState(false)

  const updateBlock = (index: number, updates: Partial<EmailContentBlock>) => {
    const newBlocks = [...blocks]
    newBlocks[index] = { ...newBlocks[index], ...updates }
    onChange(newBlocks)
  }

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const newBlocks = [...blocks]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newBlocks.length) return
    ;[newBlocks[index], newBlocks[targetIndex]] = [newBlocks[targetIndex], newBlocks[index]]
    onChange(newBlocks)
  }

  const removeBlock = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index))
  }

  const addBlock = (type: string) => {
    const newBlock: EmailContentBlock = { type: type as EmailContentBlock['type'] }
    if (type === 'heading') newBlock.text = 'New Heading'
    if (type === 'paragraph') newBlock.text = 'New paragraph text...'
    if (type === 'button') { newBlock.text = 'Click Here'; newBlock.url = '{{cta_url}}' }
    if (type === 'footnote') newBlock.text = 'Footnote text'
    if (type === 'note') { newBlock.text = ''; newBlock.label = 'Note' }
    if (type === 'user_card') { newBlock.name_var = 'requester_name'; newBlock.avatar_var = 'requester_avatar_url' }
    if (type === 'conversation_list') newBlock.conversations_var = 'conversations'
    if (type === 'card') { newBlock.title = 'Card Title'; newBlock.fields = [] }
    onChange([...blocks, newBlock])
    setShowAddMenu(false)
  }

  const renderBlockEditor = (block: EmailContentBlock, index: number) => {
    const blockType = BLOCK_TYPES.find(t => t.type === block.type)
    const Icon = blockType?.icon || AlignLeft

    return (
      <div key={index} className="border border-gray-200 rounded-lg bg-white">
        {/* Block header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
          <Icon className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-medium text-gray-600 uppercase">{blockType?.label || block.type}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => moveBlock(index, 'up')}
            disabled={index === 0}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => moveBlock(index, 'down')}
            disabled={index === blocks.length - 1}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => removeBlock(index)}
            className="p-1 text-red-400 hover:text-red-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Block body */}
        <div className="p-3 space-y-2">
          {(block.type === 'heading' || block.type === 'paragraph' || block.type === 'footnote') && (
            <>
              <textarea
                value={block.text || ''}
                onChange={(e) => updateBlock(index, { text: e.target.value })}
                placeholder="Text content (supports {{variables}})"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[60px]"
              />
              {block.type === 'heading' && (
                <select
                  value={block.level || 1}
                  onChange={(e) => updateBlock(index, { level: Number(e.target.value) })}
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                >
                  <option value={1}>H1</option>
                  <option value={2}>H2</option>
                </select>
              )}
              {block.type === 'paragraph' && (
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={block.is_html || false}
                      onChange={(e) => updateBlock(index, { is_html: e.target.checked })}
                      className="rounded"
                    />
                    Allow HTML
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={block.conditional || false}
                      onChange={(e) => updateBlock(index, { conditional: e.target.checked })}
                      className="rounded"
                    />
                    Conditional
                  </label>
                </div>
              )}
            </>
          )}

          {block.type === 'button' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={block.text || ''}
                onChange={(e) => updateBlock(index, { text: e.target.value })}
                placeholder="Button label"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                value={block.url || ''}
                onChange={(e) => updateBlock(index, { url: e.target.value })}
                placeholder="URL (e.g. {{cta_url}})"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          )}

          {block.type === 'note' && (
            <>
              <input
                value={block.label || ''}
                onChange={(e) => updateBlock(index, { label: e.target.value })}
                placeholder="Note label (optional)"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <textarea
                value={block.text || ''}
                onChange={(e) => updateBlock(index, { text: e.target.value })}
                placeholder="Note content (supports {{variables}})"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[60px]"
              />
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={block.conditional || false}
                  onChange={(e) => updateBlock(index, { conditional: e.target.checked })}
                  className="rounded"
                />
                Conditional (hide if empty)
              </label>
            </>
          )}

          {block.type === 'user_card' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={block.name_var || ''}
                onChange={(e) => updateBlock(index, { name_var: e.target.value })}
                placeholder="Name variable"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                value={block.avatar_var || ''}
                onChange={(e) => updateBlock(index, { avatar_var: e.target.value })}
                placeholder="Avatar URL variable"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                value={block.label || ''}
                onChange={(e) => updateBlock(index, { label: e.target.value })}
                placeholder="Label (optional)"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 col-span-2"
              />
              <input
                value={(block.detail_vars || []).join(', ')}
                onChange={(e) => updateBlock(index, { detail_vars: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="Detail vars (comma-separated)"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 col-span-2"
              />
            </div>
          )}

          {block.type === 'card' && (
            <div className="space-y-2">
              <input
                value={block.label || ''}
                onChange={(e) => updateBlock(index, { label: e.target.value })}
                placeholder="Card label (optional)"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                value={block.title || ''}
                onChange={(e) => updateBlock(index, { title: e.target.value })}
                placeholder="Title (supports {{variables}})"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                value={block.subtitle || ''}
                onChange={(e) => updateBlock(index, { subtitle: e.target.value })}
                placeholder="Subtitle (optional)"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          )}

          {block.type === 'conversation_list' && (
            <input
              value={block.conversations_var || 'conversations'}
              onChange={(e) => updateBlock(index, { conversations_var: e.target.value })}
              placeholder="Conversations variable name"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          )}

          {block.type === 'divider' && (
            <p className="text-xs text-gray-400 italic">Horizontal divider, no configuration needed</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => renderBlockEditor(block, index))}

      {/* Add block */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Block
        </button>

        {showAddMenu && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-2 grid grid-cols-3 gap-1">
            {BLOCK_TYPES.map(({ type, label, icon: BIcon }) => (
              <button
                key={type}
                type="button"
                onClick={() => addBlock(type)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors"
              >
                <BIcon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
