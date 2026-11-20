/**
 * Full-shape profile photo (2026-10-23, migration 20261023120000): the
 * upload helper stores a 1440 px square for avatars plus the photo in its own
 * shape for full-screen views. Crests/logos and PNGs get the square only; a
 * failed full upload never blocks the square.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const upload = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) } },
}))
const optimizeAvatarImage = vi.fn(async () => new File(['sq'], 'a.jpg', { type: 'image/jpeg' }))
const optimizeImage = vi.fn(async () => new File(['full'], 'f.jpg', { type: 'image/jpeg' }))
vi.mock('@/lib/imageOptimization', () => ({ optimizeAvatarImage: () => optimizeAvatarImage(), optimizeImage: (...a: unknown[]) => optimizeImage(...(a as [])) }))

import { profilePhotoFields, uploadProfilePhoto } from '@/lib/profilePhoto'

const jpg = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
const png = new File(['x'], 'crest.png', { type: 'image/png' })

beforeEach(() => { upload.mockReset(); upload.mockResolvedValue({ error: null }); optimizeImage.mockClear() })

describe('uploadProfilePhoto', () => {
  it('uploads the square and the full-shape photo under the member folder', async () => {
    const urls = await uploadProfilePhoto('u1', jpg)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0][0]).toMatch(/^u1\/avatar_\d+\.jpg$/)
    expect(upload.mock.calls[1][0]).toMatch(/^u1\/avatar_full_\d+\.jpg$/)
    expect(optimizeImage).toHaveBeenCalledWith(jpg, expect.objectContaining({ maxWidth: 2048, maxHeight: 2048, mimeType: 'image/jpeg' }))
    expect(urls.avatarUrl).toMatch(/avatar_\d+\.jpg$/)
    expect(urls.avatarFullUrl).toMatch(/avatar_full_\d+\.jpg$/)
  })

  it('PNG sources and full:false upload the square only', async () => {
    expect((await uploadProfilePhoto('u1', png)).avatarFullUrl).toBeNull()
    expect((await uploadProfilePhoto('u1', jpg, { full: false })).avatarFullUrl).toBeNull()
    expect(optimizeImage).not.toHaveBeenCalled()
  })

  it('a failed full upload keeps the square', async () => {
    upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('quota') })
    const urls = await uploadProfilePhoto('u1', jpg)
    expect(urls.avatarUrl).toBeTruthy()
    expect(urls.avatarFullUrl).toBeNull()
  })

  it('a failed square upload throws', async () => {
    upload.mockResolvedValueOnce({ error: new Error('denied') })
    await expect(uploadProfilePhoto('u1', jpg)).rejects.toThrow('denied')
  })

  it('profilePhotoFields writes both columns together', () => {
    expect(profilePhotoFields({ avatarUrl: 'a', avatarFullUrl: null })).toEqual({ avatar_url: 'a', avatar_full_url: null })
  })
})

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
  const PEOPLE = ['components/EditProfileModal.tsx', 'components/profile/mobile/EditProfileScreen.tsx', 'components/onboarding/PlayerSetupFlow.tsx', 'components/onboarding/CoachSetupFlow.tsx', 'lib/nextSteps.ts', 'pages/CompleteProfile.tsx']

  it('every person photo writer uses a helper that also stores the full-shape photo', () => {
    // Since 2026-11-20 the square comes from the crop step: writers call
    // uploadProfilePhoto with it, or uploadIdentityImage (which does, for people).
    for (const f of PEOPLE) {
      const src = read(f)
      expect(/uploadProfilePhoto\(|uploadIdentityImage\(/.test(src), f).toBe(true)
      expect(src, f).not.toContain('optimizeAvatarImage(')
    }
    expect(read('lib/identityImage.ts')).toContain('uploadProfilePhoto(userId, file, { square })')
  })

  it('every writer with a screen asks the crop step first', () => {
    for (const f of [...PEOPLE.filter((f) => f !== 'lib/nextSteps.ts'), 'components/club/ClubEditScreen.tsx', 'components/club/ClubSetupFlow.tsx', 'components/brands/BrandForm.tsx', 'components/brands/BrandEditScreen.tsx']) {
      expect(read(f), f).toContain('await requestCrop(file, ')
    }
  })

  it('screens that keep state write the full photo only when the photo changed', () => {
    for (const f of ['components/EditProfileModal.tsx', 'components/onboarding/PlayerSetupFlow.tsx', 'components/onboarding/CoachSetupFlow.tsx', 'pages/CompleteProfile.tsx']) {
      expect(read(f), f).toMatch(/!== \(profile\?\.avatar_url \?\? (''|null)\) \? \{ avatar_full_url:/)
    }
  })

  it("phone pickers skip the phone's own crop: the app's crop step does it for every kind", () => {
    for (const f of ['components/EditProfileModal.tsx', 'components/profile/mobile/EditProfileScreen.tsx', 'components/onboarding/PlayerSetupFlow.tsx', 'components/onboarding/CoachSetupFlow.tsx', 'components/hockiaAi/NextSteps.tsx', 'components/club/ClubEditScreen.tsx', 'components/club/ClubSetupFlow.tsx', 'components/brands/BrandForm.tsx', 'pages/CompleteProfile.tsx']) {
      expect(read(f), f).toContain("pickImageNative('prompt', { crop: false })")
      expect(read(f), f).not.toContain("pickImageNative('prompt')")
    }
    expect(read('lib/nativeImagePicker.ts')).toContain('allowEditing: crop,')
  })

  it('the deck shows the full photo when there is one, the square otherwise', () => {
    const src = read('components/community/photo/MemberFullPreview.tsx')
    expect(src).toContain('full.data ?? member.avatar_url')
    expect(src).toContain('cachedAvatarFull(m.id) ?? m.avatar_url')
  })
})
