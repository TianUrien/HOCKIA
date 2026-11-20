import { Suspense, createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { optimizeAvatarImage } from '@/lib/imageOptimization'
import type { ImageKind } from '@/lib/imageFit'

// The crop screen is only needed once someone picks an image: keep it out of the first load.
const ImageCropSheet = lazyWithRetry(() => import('./ImageCropSheet'))

/** Resolves with the square to store, or null when the member cancels. */
export type RequestCrop = (file: File, kind: ImageKind) => Promise<File | null>

// Outside the provider (isolated component tests) there is no screen to show:
// fall back to the plain centre crop.
const ImageCropContext = createContext<RequestCrop>((file) => optimizeAvatarImage(file))

interface Pending {
  file: File
  kind: ImageKind
}

export function ImageCropProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const settle = useRef<((square: File | null) => void) | null>(null)

  const requestCrop = useCallback<RequestCrop>((file, kind) => {
    // A second pick while one is open replaces it; the first resolves as cancelled.
    settle.current?.(null)
    return new Promise<File | null>((resolve) => {
      settle.current = resolve
      setPending({ file, kind })
    })
  }, [])

  const onDone = useCallback((square: File | null) => {
    settle.current?.(square)
    settle.current = null
    setPending(null)
  }, [])

  const value = useMemo(() => requestCrop, [requestCrop])

  return (
    <ImageCropContext.Provider value={value}>
      {children}
      {pending && (
        <Suspense fallback={null}>
          <ImageCropSheet file={pending.file} kind={pending.kind} onDone={onDone} />
        </Suspense>
      )}
    </ImageCropContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useImageCrop = () => useContext(ImageCropContext)
