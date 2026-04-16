import { useState, useEffect, useRef } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { logger } from '@/lib/logger'

let placesLibPromise: Promise<google.maps.PlacesLibrary> | null = null
let optionsSet = false

export interface PlacePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export interface PlaceDetails {
  city: string
  displayName: string
  countryCode: string
  countryName: string
  adminArea: string
}

export function useGooglePlaces() {
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const failCountRef = useRef(0)

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      setLoadError(true)
      return
    }

    if (!optionsSet) {
      setOptions({ key: apiKey, v: 'weekly' })
      optionsSet = true
    }

    if (!placesLibPromise) {
      placesLibPromise = importLibrary('places') as Promise<google.maps.PlacesLibrary>
    }

    placesLibPromise
      .then(() => {
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
        setIsLoaded(true)
      })
      .catch((err) => {
        logger.error('[useGooglePlaces] Failed to load:', err)
        setLoadError(true)
      })
  }, [])

  const getAutocompletePredictions = async (input: string): Promise<PlacePrediction[]> => {
    if (!isLoaded || input.trim().length < 2) return []

    try {
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()
      }

      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        includedPrimaryTypes: ['(cities)'],
      })

      return suggestions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Google Places API untyped response
        .filter((s: any) => s.placePrediction)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => {
          const p = s.placePrediction!
          return {
            placeId: p.placeId,
            description: p.text.text,
            mainText: p.mainText?.text || p.text.text,
            secondaryText: p.secondaryText?.text || '',
          }
        })
    } catch (err) {
      logger.error('[useGooglePlaces] Prediction failed:', err)
      // Detect persistent failures (e.g. 403 referrer blocked) and fall back to plain input
      failCountRef.current++
      if (failCountRef.current >= 2) {
        logger.warn('[useGooglePlaces] Multiple prediction failures — falling back to plain text input')
        setLoadError(true)
      }
      return []
    }
  }

  const getPlaceDetails = async (placeId: string): Promise<PlaceDetails | null> => {
    try {
      const place = new google.maps.places.Place({ id: placeId })
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] })

      // Reset session token after selection (billing purposes)
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken()

      const components = place.addressComponents || []
      let city = ''
      let countryCode = ''
      let countryName = ''
      let adminArea = ''

      for (const comp of components) {
        if (comp.types.includes('locality') && !city) {
          city = comp.longText ?? ''
        } else if (comp.types.includes('sublocality_level_1') && !city) {
          city = comp.longText ?? ''
        } else if (comp.types.includes('administrative_area_level_1')) {
          adminArea = comp.longText ?? ''
        } else if (comp.types.includes('country')) {
          countryCode = comp.shortText ?? ''
          countryName = comp.longText ?? ''
        }
      }

      // Fallback: if no locality found, use adminArea as city
      if (!city && adminArea) city = adminArea

      return {
        city,
        displayName: place.formattedAddress || '',
        countryCode,
        countryName,
        adminArea,
      }
    } catch (err) {
      logger.error('[useGooglePlaces] getPlaceDetails failed:', err)
      return null
    }
  }

  return { isLoaded, loadError, getAutocompletePredictions, getPlaceDetails }
}
