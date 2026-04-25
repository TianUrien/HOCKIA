/**
 * Federation / hockey body suggestions.
 *
 * Stored as free text on `profiles.federation`. This list is a datalist
 * seed covering the major FIH continental confederations plus a handful
 * of common national federations — enough that the typical umpire sees
 * their body without typing. Anyone registered with a less common body
 * just types the full name; we can swap to a proper FK table once the
 * data stabilises.
 */
export const FEDERATION_SUGGESTIONS = [
  // World body
  'FIH',
  // Continental confederations
  'EuroHockey',
  'Pan American Hockey Federation',
  'Asian Hockey Federation',
  'African Hockey Federation',
  'Oceania Hockey Federation',
  // Common national federations (alpha)
  'Argentine Hockey Confederation (CAH)',
  'Hockey Australia',
  'Belgian Hockey Association (KBHB/ARBH)',
  'Field Hockey Canada',
  'England Hockey',
  'French Hockey Federation (FFH)',
  'German Hockey Federation (DHB)',
  'Hockey India',
  'Irish Hockey Association',
  'Italian Hockey Federation (FIH-Italia)',
  'Japan Hockey Association',
  'Royal Dutch Hockey Association (KNHB)',
  'Hockey New Zealand',
  'Pakistan Hockey Federation',
  'South African Hockey Association',
  'Korea Hockey Association',
  'Spanish Field Hockey Federation (RFEH)',
  'USA Field Hockey',
  'Welsh Hockey',
  'Scottish Hockey',
] as const
