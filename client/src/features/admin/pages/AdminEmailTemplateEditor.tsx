import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  SendHorizonal,
  History,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Eye,
  FileText,
  X,
  Variable,
} from 'lucide-react'
import { getEmailTemplateDetail, saveEmailTemplateDraft, activateEmailTemplate, rollbackEmailTemplate, sendTestEmail, updateEmailTemplateName } from '../api/adminApi'
import type { EmailTemplateDetail, EmailContentBlock, EmailTemplateVariable } from '../types'
import { EmailBlockEditor } from '../components/EmailBlockEditor'
import { EmailPreview } from '../components/EmailPreview'
import { logger } from '@/lib/logger'

export function AdminEmailTemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<EmailTemplateDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editor state
  const [templateName, setTemplateName] = useState('')
  const [subject, setSubject] = useState('')
  const [blocks, setBlocks] = useState<EmailContentBlock[]>([])
  const [textTemplate, setTextTemplate] = useState('')
  const [variables, setVariables] = useState<EmailTemplateVariable[]>([])
  const [isDirty, setIsDirty] = useState(false)

  // UI state
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html')
  const [showHistory, setShowHistory] = useState(false)
  const [showTestModal, setShowTestModal] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testVars, setTestVars] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchDetail = useCallback(async () => {
    if (!templateId) return
    setIsLoading(true)
    setError(null)
    try {
      const data = await getEmailTemplateDetail(templateId)
      setDetail(data)
      setTemplateName(data.template.name)
      setSubject(data.template.subject_template)
      setBlocks(data.template.content_json)
      setTextTemplate(data.template.text_template || '')
      setVariables(data.template.variables || [])
      setIsDirty(false)
    } catch (err) {
      logger.error('[TemplateEditor] Failed to fetch:', err)
      setError(err instanceof Error ? err.message : 'Failed to load template')
    } finally {
      setIsLoading(false)
    }
  }, [templateId])

  useEffect(() => {
    document.title = 'Edit Template | PLAYR Admin'
    fetchDetail()
  }, [fetchDetail])

  // Build sample variables for preview
  const sampleVars = useMemo(() => {
    const samples: Record<string, string> = {}
    for (const v of variables) {
      if (testVars[v.name]) {
        samples[v.name] = testVars[v.name]
      } else {
        // Provide sensible defaults
        const name = v.name.toLowerCase()
        if (name.includes('name')) samples[v.name] = 'Jane Smith'
        else if (name.includes('email')) samples[v.name] = 'jane@example.com'
        else if (name.includes('url')) samples[v.name] = 'https://oplayr.com'
        else if (name.includes('title')) samples[v.name] = 'Sample Title'
        else if (name.includes('location')) samples[v.name] = 'Melbourne, Australia'
        else if (name.includes('position')) samples[v.name] = 'Forward'
        else if (name.includes('country')) samples[v.name] = 'Argentina'
        else if (name.includes('note')) samples[v.name] = 'Looking forward to working together!'
        else if (name.includes('type')) samples[v.name] = 'Teammate'
        else if (name.includes('count')) samples[v.name] = '3'
        else samples[v.name] = `[${v.name}]`
      }
    }
    samples.settings_url = 'https://oplayr.com/settings'
    return samples
  }, [variables, testVars])

  const handleSubjectChange = (value: string) => {
    setSubject(value)
    setIsDirty(true)
  }

  const handleBlocksChange = (newBlocks: EmailContentBlock[]) => {
    setBlocks(newBlocks)
    setIsDirty(true)
  }

  const handleSave = async () => {
    if (!templateId) return
    setIsSaving(true)
    setSaveMessage(null)
    try {
      // Update name if changed
      if (templateName.trim() && templateName !== detail?.template.name) {
        await updateEmailTemplateName(templateId, templateName.trim())
      }
      // Save as new version, then immediately activate it
      const result = await saveEmailTemplateDraft({
        templateId,
        subject,
        contentJson: blocks,
        text: textTemplate || undefined,
        variables,
        changeNote: 'Saved from admin editor',
      })
      await activateEmailTemplate(templateId, result.version_number)
      setSaveMessage({ type: 'success', text: 'Template saved' })
      setIsDirty(false)
      await fetchDetail()
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRollback = async (versionNumber: number) => {
    if (!window.confirm(`Rollback to version ${versionNumber}? This will replace the current live content.`)) return

    try {
      await rollbackEmailTemplate(templateId!, versionNumber)
      setSaveMessage({ type: 'success', text: `Rolled back to version ${versionNumber}` })
      await fetchDetail()
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to rollback' })
    }
  }

  const handleSendTest = async () => {
    if (!templateId || !testEmail) return
    setIsSendingTest(true)
    try {
      await sendTestEmail(templateId, testEmail, testVars)
      setSaveMessage({ type: 'success', text: `Test email sent to ${testEmail}` })
      setShowTestModal(false)
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send test' })
    } finally {
      setIsSendingTest(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load template</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button onClick={() => navigate('/admin/email?tab=notifications')} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
          Back to Templates
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin/email?tab=notifications')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{detail.template.name}</h1>
            <p className="text-sm text-gray-500 font-mono">{detail.template.template_key} &middot; v{detail.template.current_version}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTestModal(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <SendHorizonal className="w-4 h-4" />
            Send Test
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
              showHistory ? 'text-purple-700 bg-purple-50 border-purple-200' : 'text-gray-700 bg-white border-gray-200 hover:bg-gray-50'
            }`}
          >
            <History className="w-4 h-4" />
            History
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Save message toast */}
      {saveMessage && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm ${
          saveMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <span>{saveMessage.text}</span>
          <button type="button" onClick={() => setSaveMessage(null)} className="ml-4">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Version history panel */}
      {showHistory && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Version History</h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {detail.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-900">Version {v.version_number}</span>
                  {v.version_number === detail.template.current_version && (
                    <span className="ml-2 inline-flex px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 rounded-full">Active</span>
                  )}
                  <p className="text-xs text-gray-500">
                    {new Date(v.created_at).toLocaleString()}
                    {v.change_note && ` — ${v.change_note}`}
                  </p>
                </div>
                {v.version_number !== detail.template.current_version && (
                  <button
                    type="button"
                    onClick={() => handleRollback(v.version_number)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Rollback
                  </button>
                )}
              </div>
            ))}
            {detail.versions.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No versions yet</p>
            )}
          </div>
        </div>
      )}

      {/* Main editor area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Name */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
            <input
              value={templateName}
              onChange={(e) => { setTemplateName(e.target.value); setIsDirty(true) }}
              placeholder="Template display name"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Subject */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line</label>
            <input
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              placeholder="Email subject (supports {{variables}})"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Block editor */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-3">Content Blocks</label>
            <EmailBlockEditor blocks={blocks} onChange={handleBlocksChange} />
          </div>

          {/* Plain text template */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Plain Text Template</label>
            <textarea
              value={textTemplate}
              onChange={(e) => { setTextTemplate(e.target.value); setIsDirty(true) }}
              placeholder="Plain text version (supports {{variables}})"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[120px] font-mono"
            />
          </div>

          {/* Variable reference */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Variable className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Variables</span>
            </div>
            <div className="space-y-1">
              {variables.map((v) => (
                <div key={v.name} className="flex items-center gap-2 text-sm">
                  <code className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-mono">{'{{' + v.name + '}}'}</code>
                  <span className="text-gray-500 text-xs">{v.description}</span>
                  {v.required && <span className="text-red-400 text-xs">*</span>}
                </div>
              ))}
              {variables.length === 0 && (
                <p className="text-xs text-gray-400">No variables defined</p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewMode('html')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                previewMode === 'html' ? 'bg-purple-50 text-purple-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Eye className="w-4 h-4" />
              HTML Preview
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('text')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                previewMode === 'text' ? 'bg-purple-50 text-purple-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileText className="w-4 h-4" />
              Plain Text
            </button>
          </div>

          <div className="sticky top-20">
            <EmailPreview
              subject={subject}
              blocks={blocks}
              variables={sampleVars}
              mode={previewMode}
              isOutreach={detail.template.template_key.startsWith('outreach_')}
            />
          </div>
        </div>
      </div>

      {/* Test Send Modal */}
      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Send Test Email</h3>
              <button type="button" onClick={() => setShowTestModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Variable Overrides</label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {variables.map((v) => (
                    <div key={v.name} className="flex items-center gap-2">
                      <code className="text-xs font-mono text-purple-700 min-w-[120px]">{v.name}</code>
                      <input
                        value={testVars[v.name] || ''}
                        onChange={(e) => setTestVars(prev => ({ ...prev, [v.name]: e.target.value }))}
                        placeholder={sampleVars[v.name] || 'value'}
                        className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendTest}
                disabled={isSendingTest || !testEmail}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {isSendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
                Send Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
