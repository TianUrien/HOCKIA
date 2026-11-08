import { describe, it, expect } from 'vitest'
import { applyRoleMismatch } from '@/lib/applyRoleMatch'
import { validateImage, withImageExtension, imageFileExtension } from '@/lib/imageOptimization'

const file = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type })

describe('applyRoleMismatch (Sentry JAVASCRIPT-REACT-EC)', () => {
  it('blocks a coach from a player opportunity and a player from a coach one', () => {
    expect(applyRoleMismatch('player', 'coach')).toBe('This opportunity is for players.')
    expect(applyRoleMismatch('coach', 'player')).toBe('This opportunity is for coaches.')
  })
  it('lets matching roles through', () => {
    expect(applyRoleMismatch('player', 'player')).toBeNull()
    expect(applyRoleMismatch('coach', 'coach')).toBeNull()
  })
  it('stays out of the way when it cannot tell', () => {
    expect(applyRoleMismatch(null, 'coach')).toBeNull()
    expect(applyRoleMismatch('player', null)).toBeNull()
    expect(applyRoleMismatch('player', 'club')).toBeNull()
  })
})

describe('validateImage (Sentry JAVASCRIPT-REACT-E6)', () => {
  const opts = { maxFileSizeMB: 10 }
  it('accepts an Android gallery pick with a JPEG type and no extension', () => {
    expect(validateImage(file('1000012345', 'image/jpeg'), opts).valid).toBe(true)
  })
  it('accepts a .jpg with no type, by its extension', () => {
    expect(validateImage(file('photo.jpg', ''), opts).valid).toBe(true)
    expect(validateImage(file('photo.png', 'application/octet-stream'), opts).valid).toBe(true)
  })
  it('still refuses other image types and files with neither', () => {
    expect(validateImage(file('photo.heic', 'image/heic'), opts).valid).toBe(false)
    expect(validateImage(file('photo.gif', 'image/gif'), opts).valid).toBe(false)
    expect(validateImage(file('doc.pdf', 'application/pdf'), opts).valid).toBe(false)
    expect(validateImage(file('1000012345', ''), opts).valid).toBe(false)
  })
  it('a type the picker gives wins over a misleading extension', () => {
    expect(validateImage(file('photo.jpg', 'image/gif'), opts).valid).toBe(false)
  })
  it('keeps the size limit', () => {
    expect(validateImage(file('1000012345', 'image/jpeg', 11 * 1024 * 1024), opts).valid).toBe(false)
  })
})

describe('image file names and extensions', () => {
  it('names the encoded file by its type', () => {
    expect(withImageExtension('1000012345', 'image/jpeg')).toBe('1000012345.jpg')
    expect(withImageExtension('photo.HEIC', 'image/jpeg')).toBe('photo.jpg')
    expect(withImageExtension('shot.png', 'image/png')).toBe('shot.png')
    expect(withImageExtension('', 'image/jpeg')).toBe('photo.jpg')
  })
  it('picks the storage extension from the type, then the name', () => {
    expect(imageFileExtension(file('1000012345', 'image/jpeg'))).toBe('jpg')
    expect(imageFileExtension(file('x', 'image/png'))).toBe('png')
    expect(imageFileExtension(file('x.png', ''))).toBe('png')
    expect(imageFileExtension(file('x', ''))).toBe('jpg')
  })
})
