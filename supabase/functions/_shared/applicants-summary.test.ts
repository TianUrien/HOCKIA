import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { sanitizeApplicants, summaryFacts } from './applicants-summary.ts'

Deno.test('only whitelisted facts survive; names are first names only', () => {
  const list = sanitizeApplicants([
    { name: 'Lucía Fernández', daysLeft: 3, position: 'primary', category: true, open: true, level: 'close', age: 24, nationality: 'AR', photo: 'x' },
    { name: '<script>', position: 'striker', level: 'elite' },
    { name: '' },
  ])
  assertEquals(list.length, 2)
  assertEquals(list[0], { name: 'Lucía', daysLeft: 3, position: 'primary', category: true, open: true, level: 'close', invited: false })
  assertEquals(list[1].name, 'script')
  assertEquals(list[1].position, 'n/a')
  assertEquals(list[1].level, 'unknown')
})

Deno.test('the facts line never carries age or nationality', () => {
  const f = summaryFacts('Goalkeeper', sanitizeApplicants([{ name: 'Zahra', daysLeft: 9, position: 'primary', category: true, open: true, level: 'further', age: 21, nationality: 'IR' }]))
  assertStringIncludes(f, 'Zahra, plays the role\'s position, team category matches, open to play, plays a little further from the club\'s level, 9 days left to reply')
  assertEquals(/21|IR|age|national/i.test(f), false)
})
