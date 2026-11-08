import { describe, expect, it } from 'vitest'
import { packWideCards } from '@/lib/communityGridPack'

// 'C' = a club (spans the row), anything else = a person card.
const pack = (s: string, cols = 2) => packWideCards(s.split(''), (x) => x === 'C', cols).join('')

describe('packWideCards: no hole beside a lone person card (iOS audit 2026-11-06)', () => {
  it('leaves a list that already fills its rows untouched', () => {
    expect(pack('CabCcdC')).toBe('CabCcdC')
  })
  it('holds a club until the row of people before it is full', () => {
    expect(pack('CaCbc')).toBe('CabCc')
  })
  it('clubs left at the end go before the unfinished last row', () => {
    expect(pack('CaCC')).toBe('CCCa')
    expect(pack('abcCd')).toBe('abcdC')
    expect(pack('abcC')).toBe('abCc')
  })
  it('works with four columns', () => {
    expect(pack('abCcdefg', 4)).toBe('abcdCefg')
  })
  it('keeps every item exactly once', () => {
    const input = 'aCbCCcdCe'
    expect(pack(input).split('').sort().join('')).toBe(input.split('').sort().join(''))
  })
})
