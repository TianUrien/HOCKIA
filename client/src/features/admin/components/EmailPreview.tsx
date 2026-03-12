import { useMemo } from 'react'
import type { EmailContentBlock } from '../types'

interface EmailPreviewProps {
  subject: string
  blocks: EmailContentBlock[]
  variables: Record<string, string>
  mode?: 'html' | 'text'
  isOutreach?: boolean
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, varName) => vars[varName] ?? `{{${varName}}}`)
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderBlockHtml(block: EmailContentBlock, vars: Record<string, string>): string {
  const interp = (s?: string) => s ? interpolate(s, vars) : ''

  switch (block.type) {
    case 'heading': {
      const text = interp(block.text)
      if (!text) return ''
      const tag = block.level === 2 ? 'h2' : 'h1'
      const fontSize = block.level === 2 ? '20px' : '24px'
      return `<${tag} style="color:#1f2937;margin:0 0 8px;font-size:${fontSize};font-weight:700;">${escapeHtml(text)}</${tag}>`
    }
    case 'paragraph': {
      const text = interp(block.text)
      if (!text && block.conditional) return ''
      const content = block.is_html ? text : escapeHtml(text)
      return `<p style="color:#6b7280;margin:0 0 24px;font-size:16px;">${content}</p>`
    }
    case 'button': {
      const text = interp(block.text) || 'Learn More'
      const url = interp(block.url)
      if (!url) return ''
      return `<div style="text-align:center;margin-bottom:24px;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#8026FA,#924CEC);color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;">${escapeHtml(text)}</a></div>`
    }
    case 'divider':
      return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />'
    case 'footnote': {
      const text = interp(block.text)
      if (!text) return ''
      return `<p style="color:#9ca3af;font-size:13px;margin:24px 0 0;text-align:center;">${escapeHtml(text)}</p>`
    }
    case 'note': {
      const text = interp(block.text)
      if (!text && block.conditional) return ''
      if (!text) return ''
      const label = interp(block.label)
      return `<div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:24px;">${label ? `<p style="color:#92400e;margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;">${escapeHtml(label)}</p>` : ''}<p style="color:#78350f;margin:0;font-size:14px;line-height:1.5;">${escapeHtml(text)}</p></div>`
    }
    case 'card': {
      const title = interp(block.title)
      const subtitle = interp(block.subtitle)
      const label = interp(block.label)
      return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:16px;">${label ? `<p style="color:#6b7280;margin:0 0 4px;font-size:13px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(label)}</p>` : ''}${title ? `<h2 style="color:#1f2937;margin:0 0 4px;font-size:20px;font-weight:600;">${escapeHtml(title)}</h2>` : ''}${subtitle ? `<p style="color:#8026FA;margin:0;font-size:15px;font-weight:500;">${escapeHtml(subtitle)}</p>` : ''}</div>`
    }
    case 'user_card': {
      const name = interp(block.name_var ? `{{${block.name_var}}}` : '') || 'User'
      const label = interp(block.label)
      return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:24px;">${label ? `<p style="color:#6b7280;margin:0 0 12px;font-size:13px;font-weight:500;text-transform:uppercase;">${escapeHtml(label)}</p>` : ''}<p style="color:#1f2937;margin:0;font-size:18px;font-weight:600;">${escapeHtml(name)}</p></div>`
    }
    case 'conversation_list':
      return '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin-bottom:8px;"><p style="color:#6b7280;font-size:14px;margin:0;">[Conversation cards rendered dynamically]</p></div>'
    default:
      return ''
  }
}

export function EmailPreview({ subject, blocks, variables, mode = 'html', isOutreach = false }: EmailPreviewProps) {
  const html = useMemo(() => {
    if (mode === 'text') return null

    const body = blocks.map(b => renderBlockHtml(b, variables)).filter(Boolean).join('\n')
    const settingsUrl = variables.settings_url || 'https://oplayr.com/settings'

    const footerHtml = isOutreach
      ? `<p style="color:#9ca3af;font-size:12px;margin:0;">You received this email because we believe your organization may benefit from PLAYR.<br><a href="https://oplayr.com" style="color:#8026FA;text-decoration:none;">Learn more about PLAYR</a></p>`
      : `<p style="color:#9ca3af;font-size:12px;margin:0;">You're receiving this because you're on PLAYR.<br><a href="${settingsUrl}" style="color:#8026FA;text-decoration:none;">Manage notification preferences</a></p>`

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;">
<div style="background:linear-gradient(135deg,#8026FA,#924CEC);padding:32px 24px;border-radius:16px 16px 0 0;text-align:center;">
  <img src="https://www.oplayr.com/playr-logo-white.png" alt="PLAYR" width="120" height="29" style="height:29px;width:120px;" />
</div>
<div style="background:#fff;padding:32px 24px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
  ${body}
</div>
<div style="background:#f3f4f6;padding:20px 24px;border-radius:0 0 16px 16px;border:1px solid #e5e7eb;border-top:none;text-align:center;">
  ${footerHtml}
</div>
</body></html>`
  }, [blocks, variables, mode, isOutreach])

  const textContent = useMemo(() => {
    if (mode !== 'text') return null
    return blocks
      .map(b => {
        const text = b.text ? interpolate(b.text, variables) : ''
        if (b.type === 'divider') return '---'
        if (b.type === 'button') return `[${text}] ${interpolate(b.url || '', variables)}`
        return text
      })
      .filter(Boolean)
      .join('\n\n')
  }, [blocks, variables, mode])

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
      {/* Subject preview */}
      <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
        <p className="text-xs text-gray-500">Subject:</p>
        <p className="text-sm font-medium text-gray-900">{interpolate(subject, variables)}</p>
      </div>

      {mode === 'html' && html ? (
        <iframe
          srcDoc={html}
          title="Email preview"
          className="w-full h-[600px] border-0"
          sandbox="allow-same-origin"
        />
      ) : (
        <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono max-h-[600px] overflow-y-auto">
          {textContent}
        </pre>
      )}
    </div>
  )
}
