/**
 * AddContactModal Component
 *
 * Simple form modal for manually adding a single outreach contact.
 * Fields: email (required), club name (required), contact name, country,
 * role at club, instagram, notes.
 */

import { useState } from 'react'
import { X, Loader2, UserPlus } from 'lucide-react'
import { addOutreachContact } from '../api/outreachApi'
import { logger } from '@/lib/logger'

interface AddContactModalProps {
  onClose: () => void
  onAdded: () => void
}

export function AddContactModal({ onClose, onAdded }: AddContactModalProps) {
  const [email, setEmail] = useState('')
  const [clubName, setClubName] = useState('')
  const [contactName, setContactName] = useState('')
  const [country, setCountry] = useState('')
  const [roleAtClub, setRoleAtClub] = useState('')
  const [instagram, setInstagram] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = email.trim() && email.includes('@') && clubName.trim() && !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setError(null)
    try {
      await addOutreachContact({
        email: email.trim(),
        club_name: clubName.trim(),
        contact_name: contactName.trim() || undefined,
        country: country.trim() || undefined,
        role_at_club: roleAtClub.trim() || undefined,
        instagram: instagram.trim().replace(/^@/, '') || undefined,
        notes: notes.trim() || undefined,
      })
      onAdded()
    } catch (err) {
      logger.error('[AddContactModal] Failed to add contact:', err)
      setError(err instanceof Error ? err.message : 'Failed to add contact')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">Add Contact</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Email — required */}
          <div>
            <label htmlFor="ac-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="ac-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@club.com"
              required
              autoFocus
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Club Name — required */}
          <div>
            <label htmlFor="ac-club" className="block text-sm font-medium text-gray-700 mb-1">
              Club <span className="text-red-500">*</span>
            </label>
            <input
              id="ac-club"
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Club name"
              required
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Contact Name + Country — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ac-name" className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                id="ac-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Contact person"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label htmlFor="ac-country" className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <input
                id="ac-country"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Argentina"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Role + Instagram — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ac-role" className="block text-sm font-medium text-gray-700 mb-1">
                Role at Club
              </label>
              <input
                id="ac-role"
                type="text"
                value={roleAtClub}
                onChange={(e) => setRoleAtClub(e.target.value)}
                placeholder="e.g. Secretary"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label htmlFor="ac-instagram" className="block text-sm font-medium text-gray-700 mb-1">
                Instagram
              </label>
              <input
                id="ac-instagram"
                type="text"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@handle"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="ac-notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              id="ac-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context about this contact..."
              rows={2}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Contact
          </button>
        </div>
      </div>
    </div>
  )
}
