/**
 * ShareLinkManager Component
 *
 * Admin UI for creating, viewing, and revoking shareable investor dashboard links.
 */

import { useState } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import { Link2, Copy, Trash2, Plus, Check, ExternalLink } from 'lucide-react'
import type { InvestorShareToken } from '../types'
import { getShareOrigin } from '@/lib/profileShare'

interface ShareLinkManagerProps {
  tokens: InvestorShareToken[]
  loading: boolean
  onCreateToken: (name: string, expiresInDays?: number) => Promise<void>
  onRevokeToken: (tokenId: string) => Promise<void>
}

export function ShareLinkManager({
  tokens,
  loading,
  onCreateToken,
  onRevokeToken,
}: ShareLinkManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(30)
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const activeTokens = tokens.filter((t) => t.is_active)
  const revokedTokens = tokens.filter((t) => !t.is_active)

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return

    setIsSubmitting(true)
    try {
      await onCreateToken(newTokenName.trim(), expiresInDays)
      setNewTokenName('')
      setIsCreating(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = async (token: string) => {
    // Pin to the canonical https origin on native so admins copying
    // investor links from the iOS app don't paste capacitor://localhost
    // dead URLs into emails.
    const url = `${getShareOrigin()}/investors/${token}`
    await navigator.clipboard.writeText(url)
    setCopiedTokenId(token)
    setTimeout(() => setCopiedTokenId(null), 2000)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    return formatAdminDate(dateStr)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4 animate-pulse">
          <div className="w-5 h-5 bg-gray-200 rounded" />
          <div className="h-5 w-32 bg-gray-200 rounded" />
        </div>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-gray-500" />
          <h3 className="font-semibold text-gray-900">Shareable Links</h3>
          <span className="text-sm text-gray-500">({activeTokens.length} active)</span>
        </div>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Link
          </button>
        )}
      </div>

      {/* Create new token form */}
      {isCreating && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Link name (e.g., YC Application)"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              autoFocus
            />
            <select
              value={expiresInDays ?? ''}
              onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : undefined)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">Never expires</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setIsCreating(false)
                setNewTokenName('')
              }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateToken}
              disabled={!newTokenName.trim() || isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isSubmitting ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Create
            </button>
          </div>
        </div>
      )}

      {/* Active tokens */}
      {activeTokens.length === 0 && !isCreating ? (
        <div className="text-center py-8 text-gray-500">
          <Link2 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No shareable links yet</p>
          <p className="text-xs text-gray-400 mt-1">Create a link to share metrics with investors</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeTokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{token.name}</span>
                  {token.expires_at && new Date(token.expires_at) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                      Expires soon
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  <span>Created {formatDate(token.created_at)}</span>
                  {token.expires_at && <span>Expires {formatDate(token.expires_at)}</span>}
                  <span>{token.access_count} views</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/investors/${token.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                  title="Preview"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => handleCopyLink(token.token)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  {copiedTokenId === token.token ? (
                    <>
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => onRevokeToken(token.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Revoke"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revoked tokens (collapsed by default) */}
      {revokedTokens.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
            {revokedTokens.length} revoked link{revokedTokens.length !== 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {revokedTokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center gap-3 p-2 text-gray-400 line-through"
              >
                <span className="text-sm">{token.name}</span>
                <span className="text-xs">Revoked {formatDate(token.revoked_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
