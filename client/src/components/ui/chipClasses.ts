/**
 * Chip / tab / anchor selection colours (founder ruling 2026-10-05, design
 * audit 2026-10-21 A4): selected = brand/soft fill + brand/text (violet-700,
 * rebrand 2026-10-25) text,
 * never solid black or solid violet; unselected = outline on white (the old
 * grey-fill phone chips move to outline). Both carry a 1 px border so the
 * pill doesn't shift when it toggles.
 */
export const CHIP_SELECTED = 'border border-transparent bg-brand-soft text-brand-text'
export const CHIP_UNSELECTED = 'border border-line bg-white text-ink-1'

/** The selection classes for a chip-like control. */
export function chipTone(selected: boolean): string {
  return selected ? CHIP_SELECTED : CHIP_UNSELECTED
}
