# Motion and haptics

Principle (approved 2026-10-16 from a tappable prototype): everything responds to the finger like a physical object, App Store style. Every motion is a spring defined by **response (s) + damping ratio**, never a fixed duration; springs are interruptible and inherit finger velocity. Solver: `client/src/lib/spring.ts` (no animation library; respect the bundle budgets in `docs/engineering/standards.md`).

| Moment | Spec |
|---|---|
| Press (cards, rows, buttons) | scale 1 → 0.96 on pointerdown (response 0.28, damping 0.90); release → 1 (0.45 / 0.62, small overshoot); moving > 8 pt cancels and lets the list scroll |
| Card → detail (phone) | card rect → full screen, radius 24 → 0, card face crossfades into the detail (0.48 / 0.82); list behind dims 25 % and scales 0.97; tab bar slides away; light haptic |
| Close | reverse from the current rect (0.44 / 0.86), lands in the card slot |
| Drag to dismiss | from scrollTop 0: scale 1 → 0.80 (d / 1100); dismiss if d > 110 pt or velocity > 700 pt/s (hand the velocity to the close spring); light haptic once at 110 pt |
| Hero | overscroll stretches the cover (1 + abs(y) / 460); scroll parallax 0.35× |
| Sheets | open 0.48 / 0.86, close 0.42 / 1.0; drag follows the finger; close below 75 % or > 600 pt/s |
| Send / Save morph | pill → 52 pt spinner → green check; content crossfades to the result |
| Large title | fades over 10–46 pt; inline title + glass bar fade in over 30–60 pt |
| Tab bar (iOS) | minimises after 120 pt scrolling down; expands on scroll up / at top / on tap; Android keeps it fixed |
| Filters | items collapse / return (scale 0.94 → 1 + fade); a rail with < 2 cards hides |
| Community deck | horizontal swipe = next / previous member; tap left/right of the photo = previous/next photo |
| Home | header hides on scroll; images blur up; pull-to-refresh = a 20 pt ball; Congrats burst is calm (few faint confetti, no sparkles) |
| Hockia AI mascot | headband light: calm glow, thinking sweep (also the typing indicator), idea flash on success; wave plays once when the sheet opens, then crossfades into idle |

## Haptics (`client/src/lib/haptics.ts`)
Only where they confirm something: selection on chips and segments; light on opening a card/sheet and on the drag-dismiss threshold; success on sent/saved. Never on every button. iOS WKWebView has no vibration API: native only.

## Reduce Motion
No expansion, drag scale or parallax: 200 ms crossfades; mascot shows posters instead of clips.

## Desktop
The role detail opens as a page (no phone expansion). Cards lift 2 pt + shadow on hover; the press spring stays. Keyboard paths for repeated decisions (applicants: ↑/↓, S / M / D with the existing undo toast).
