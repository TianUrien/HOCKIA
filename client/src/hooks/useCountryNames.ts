import { useCountries } from '@/hooks/useCountries'

/** Country names for ids, in the order chosen (brand offers: where members live). */
export function useCountryNames() {
  const { getCountryById } = useCountries()
  return (ids: number[] | null | undefined) =>
    (ids ?? []).map((id) => { const c = getCountryById(id); return c ? (c.common_name || c.name) : null }).filter((n): n is string => Boolean(n))
}
