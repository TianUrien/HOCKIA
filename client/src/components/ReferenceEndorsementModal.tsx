import { useEffect, useState } from 'react'
import Modal from './Modal'

interface ReferenceEndorsementModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (endorsement: string | null) => Promise<boolean>
  loading: boolean
  requesterName: string
  relationshipType: string
  requestNote?: string | null
  /** When set, the modal opens in edit mode with pre-filled text */
  existingEndorsement?: string | null
  /** 'accept' = responding to a request, 'edit' = editing an existing endorsement */
  mode?: 'accept' | 'edit'
}

export default function ReferenceEndorsementModal({
  isOpen,
  onClose,
  onSubmit,
  loading,
  requesterName,
  relationshipType,
  requestNote,
  existingEndorsement,
  mode = 'accept',
}: ReferenceEndorsementModalProps) {
  const [endorsement, setEndorsement] = useState('')

  // Populate with existing text when opening in edit mode
  useEffect(() => {
    if (isOpen && mode === 'edit' && existingEndorsement) {
      setEndorsement(existingEndorsement)
    } else if (isOpen && mode === 'accept') {
      setEndorsement('')
    }
  }, [isOpen, mode, existingEndorsement])

  const handleClose = () => {
    if (loading) return
    setEndorsement('')
    onClose()
  }

  const handleSubmit = async () => {
    const success = await onSubmit(endorsement.trim() ? endorsement.trim() : null)
    if (success) {
      setEndorsement('')
      onClose()
    }
  }

  const isEditMode = mode === 'edit'

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-lg">
      <div className="space-y-6 p-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-hockia-primary">
            {isEditMode ? 'Edit Endorsement' : 'Add Endorsement'}
          </p>
          <h2 className="text-2xl font-bold text-gray-900">
            {isEditMode ? `Update your endorsement for ${requesterName}` : `Share a few words about ${requesterName}`}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            This note will appear on their public profile as part of your trusted reference.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
          <p className="font-semibold text-gray-800">Relationship</p>
          <p>{relationshipType}</p>
          {!isEditMode && requestNote && (
            <div className="mt-3">
              <p className="font-semibold text-gray-800">Their note</p>
              <p className="whitespace-pre-wrap">{requestNote}</p>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="endorsement" className="text-sm font-medium text-gray-700">
            Endorsement (optional)
          </label>
          <textarea
            id="endorsement"
            rows={6}
            maxLength={800}
            value={endorsement}
            onChange={(event) => setEndorsement(event.target.value)}
            placeholder="Add a quick testimonial or highlight their impact."
            className="mt-2 w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hockia-primary focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-gray-400">{endorsement.length}/800</p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 rounded-2xl border border-gray-200 px-4 py-2 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2 font-semibold text-white shadow-lg shadow-emerald-500/30 transition-opacity disabled:opacity-60"
          >
            {loading ? 'Saving…' : isEditMode ? 'Save Changes' : 'Accept & Share'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
