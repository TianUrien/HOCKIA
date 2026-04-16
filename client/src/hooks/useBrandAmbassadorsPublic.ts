import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface PublicAmbassador {
  player_id: string
  full_name: string | null
  avatar_url: string | null
  position: string | null
  current_club: string | null
}

export function useBrandAmbassadorsPublic(brandId: string | null | undefined) {
  const [ambassadors, setAmbassadors] = useState<PublicAmbassador[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const fetchAmbassadors = useCallback(async () => {
    if (!brandId) {
      setAmbassadors([])
      setTotal(0)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)

       
      const { data, error } = await supabase.rpc('get_brand_ambassadors_public', {
        p_brand_id: brandId,
      })

      if (error) throw error

      const result = data as unknown as { ambassadors: PublicAmbassador[]; total: number }
      setAmbassadors(result.ambassadors)
      setTotal(result.total)
    } catch (err) {
      logger.error('[useBrandAmbassadorsPublic] error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    void fetchAmbassadors()
  }, [fetchAmbassadors])

  return { ambassadors, total, isLoading }
}
