import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { directoryFacts, UNKNOWN_FACTS, weekWindows, type DirectoryFacts } from '@/lib/seo/aboutFaq'

/**
 * The world directory's live numbers for the countries answer on /faq: the
 * same two reads the server makes (api/_publicData.ts fetchDirectoryFacts).
 * Clubs only, no people. Unknown until read, and on any failure, so the
 * sentence shows without a number instead of a stale or zero one.
 */
export function useDirectoryFacts(): DirectoryFacts {
  const [facts, setFacts] = useState<DirectoryFacts>(UNKNOWN_FACTS)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [countries, ...weeks] = await Promise.all([
          supabase.from('world_countries_with_directory').select('total_clubs'),
          ...weekWindows(new Date()).map((w) =>
            supabase.from('world_clubs').select('id').gte('created_at', w.from).lt('created_at', w.to).limit(1),
          ),
        ])
        if (cancelled) return
        setFacts(directoryFacts(
          countries.error || !countries.data ? null : countries.data.map((c) => c.total_clubs),
          weeks.map((w) => (w.error || !w.data ? null : w.data.length > 0)),
        ))
      } catch {
        // Keep the unknown facts: the answer reads without the number.
      }
    })()
    return () => { cancelled = true }
  }, [])

  return facts
}
