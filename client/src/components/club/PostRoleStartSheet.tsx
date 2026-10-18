import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { MascotAvatar } from '@/components/hockiaAi/mascot'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { AI_TEXT_MAX, aiDraftFailedCopy, type AiRoleDraft, type PostRoleStartState } from '@/lib/postRoleAi'

/**
 * Post a role — how do you want to start? (Figma 05 Club speed · CS1 205:1132).
 * "Start with Hockia AI": one sentence → Hockia AI fills steps 1–3 and the
 * club checks it (CS2) before anything is posted. "Start from scratch" opens
 * the three steps empty. (Post again from a closed role comes in its own PR.)
 */
const NEW_ROLE = '/dashboard/opportunities/new'

export function PostRoleStartSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [text, setText] = useState('')
  const [drafting, setDrafting] = useState(false)

  useEffect(() => { if (!open) { setText(''); setDrafting(false) } }, [open])

  const go = (state: PostRoleStartState | null, method: 'ai' | 'scratch' | 'ai_fallback') => {
    onClose()
    if (state) navigate(NEW_ROLE, { state })
    else navigate(NEW_ROLE)
    trackDbEvent('post_role_start', 'vacancy', undefined, { method })
  }

  const draft = async () => {
    const sentence = text.trim()
    if (sentence.length < 3 || drafting) return
    setDrafting(true)
    try {
      const { data, error } = await supabase.functions.invoke('role-description-draft', { body: { mode: 'from_text', text: sentence } })
      if (error) throw error
      const res = data as { draft?: AiRoleDraft | null; reason?: string } | null
      if (res?.draft) { go({ ai: { draft: res.draft, text: sentence } }, 'ai'); return }
      addToast(aiDraftFailedCopy(res?.reason), 'info')
      go({ scratchText: sentence }, 'ai_fallback')
    } catch (err) {
      logger.error('[PostRoleStart] draft failed', err)
      addToast(aiDraftFailedCopy(null), 'info')
      go({ scratchText: sentence }, 'ai_fallback')
    } finally {
      setDrafting(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!drafting) onClose() }} ariaLabel="Post a role">
      <div className="flex flex-col gap-3.5 px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-1" data-testid="post-role-start">
        <h2 className="text-[22px] font-bold leading-[27px] tracking-[-0.13px] text-ink-1">Post a role</h2>
        <div className="flex flex-col gap-3 rounded-[20px] bg-brand-soft p-4" data-testid="post-role-ai">
          <div className="flex items-center gap-2.5">
            <MascotAvatar state={drafting ? 'thinking' : 'calm'} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold leading-[21px] text-ink-1">Start with Hockia AI</p>
              <p className="text-secondary text-brand-primary">Beta · say it in your own words</p>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, AI_TEXT_MAX))}
            rows={3}
            disabled={drafting}
            placeholder="Left back for our men’s 1st team, paid, with housing, from January"
            aria-label="Describe the role in your own words"
            className="w-full resize-none rounded-[14px] bg-white px-3.5 py-3 text-body text-ink-1 outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-70"
            data-testid="post-role-ai-text"
          />
          <button
            type="button"
            onClick={() => void draft()}
            disabled={drafting || text.trim().length < 3}
            className="flex h-12 w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-50"
            data-testid="post-role-ai-draft"
          >
            {drafting ? 'Drafting your role…' : 'Draft my role'}
          </button>
          <p className="text-secondary text-ink-2">Hockia AI fills in the role, the offer and the description. Nothing is posted until you check it.</p>
        </div>
        <button
          type="button"
          onClick={() => go(null, 'scratch')}
          disabled={drafting}
          className="flex items-center gap-3 rounded-[16px] bg-surface-subtle px-4 py-3 text-left disabled:opacity-50"
          data-testid="post-role-scratch"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] leading-[22px] text-ink-1">Start from scratch</span>
            <span className="block text-secondary text-ink-2">The three steps, empty</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </BottomSheet>
  )
}
