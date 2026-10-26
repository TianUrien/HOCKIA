/**
 * Chip / tab / anchor selection colours (founder ruling 2026-10-05, design
 * audit 2026-10-21 A4): selected = brand/soft fill + brand/text (violet-700,
 * rebrand 2026-10-25) text,
 * never solid black or solid violet; unselected = outline on white (the old
 * grey-fill phone chips move to outline). Rebrand 2026-10-25 (Figma Chip /
 * Selectable 74:357): the selected chip adds a 1.5 px violet border. Callers
 * set a fixed height, so the pill doesn't shift when it toggles.
 */
export const CHIP_SELECTED = 'border-[1.5px] border-brand-primary bg-brand-soft text-brand-text'
export const CHIP_UNSELECTED = 'border border-line bg-white text-ink-1'

/** The selection classes for a chip-like control. */
export function chipTone(selected: boolean): string {
  return selected ? CHIP_SELECTED : CHIP_UNSELECTED
}
