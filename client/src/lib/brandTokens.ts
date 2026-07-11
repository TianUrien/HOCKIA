/**
 * Brand color tokens for JS contexts (Recharts props, SVG attributes, canvas)
 * where Tailwind classes can't reach.
 *
 * SINGLE SOURCE RULE: these MUST stay in sync with `tailwind.config.js`
 * (colors.hockia-primary / hockia-secondary) and the CSS vars in
 * `globals.css`. The brand-flip (Home redesign Q1) is: change the values in
 * those three places + this file + the flip touchpoints listed in the Phase-0
 * notes (index.html meta, email templates) — never hand-edit components.
 */
export const HOCKIA_PRIMARY = '#8026FA'
export const HOCKIA_SECONDARY = '#924CEC'
