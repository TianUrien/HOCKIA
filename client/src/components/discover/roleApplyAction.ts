import { createContext } from 'react'
import type { OpportunityResultItem } from '@/hooks/useDiscover'

/** Inside the Hockia AI sheet: "Prepare my application" under each role (handoff A4). Absent elsewhere (/discover). */
export const RoleApplyActionContext = createContext<((role: OpportunityResultItem) => void) | null>(null)
