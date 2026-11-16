/** The full "opportunities" catalog: import from here to translate opportunities copy. */
import en from '@/locales/en/opportunities.json'
import { registerNamespace } from '@/i18n'

registerNamespace('opportunities', en)

export { tOpportunities, useOpportunitiesT } from './opportunities.core'
