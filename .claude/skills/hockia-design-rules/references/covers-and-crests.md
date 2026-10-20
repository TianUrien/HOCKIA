# Covers, crests and imagery

## Ruling (2026-10-16)
When something has no photo (today: every opportunity), its cover is generated from the **club's own colours, read from its crest**. The category colour never tints a background. No crest, or an independent coach → HOCKIA violet. Never a grey placeholder.
Why: a category-coloured cover clashed with clubs' crests; covers must feel like the club.

## Fallback ladder (opportunity covers)
1. **Photo**: optional cover photo uploaded at publish (`opportunities.cover_url`; moderated through the admin takedown flow). Scrim + glass chips.
2. **Crest cover**: gradient from the crest's dominant colour, glow from its second colour, crest watermark.
3. **Coach cover**: independent coach: HOCKIA violet + the coach's photo as a soft monochrome circle watermark; avatar circle, not a crest tile. A coach recruiting **for** a club uses that club's crest, never their face.
4. **Monogram**: club without a crest: HOCKIA violet + the club's initials set very large.

## Palette extraction (one extractor app-wide)
`client/src/lib/crestPalette.ts` (`CREST_PALETTE_VERSION`), stored on `club_crest_colors` / `world_club_crest_colors`; the older single `color` derives from the same palette so Home, Community, Profile and Opportunities agree (ADR 0009).
- Ignore transparent, near-white (L > 0.93) and near-black (L < 0.06) pixels; keep saturated buckets (s ≥ 0.30); group into 30° hue families weighted pixels × saturation.
- **Yellows/golds (hue 35–75°) count 25 % for the background and become the glow**: darkened gold reads olive/brown.
- Stops: HSL(h, min(s, 0.85) × 0.9, 0.46) → (h, s, 0.27) → (h, s, 0.11) at 135°; glow = second colour at 38 % alpha, radial from top-left.
- Yellow-only crest (black & amber) → warm near-black base + gold glow. Monochrome crest → graphite on covers (Community cards keep their pre-approved violet).
- A manual "pick your club colours" override (`source: "manual"`) is planned and is never overwritten by the automatic pass.

## Rendering recipe
`radial-gradient(120% 90% at 18% 22%, <glow>61, transparent 60%), linear-gradient(135deg, stop0, stop1 55%, stop2)`; crest watermark 16–17 % opacity, `mix-blend-mode: luminosity`, rotated −8°, top-right, ~72 % of card width; bottom scrim for white text. Featured card bottom strip = stop2 at 62 % + backdrop blur 24 (App Store "Get" strip).

## Other no-photo treatments
- **Club cards (Community)** without a cover photo: crest-colour gradient + full field hockey pitch lines (~12 %) + large crisp crest on a white padded tile; covers smaller than 600 px fall back to this.
- **Person without a photo**: role gradient + initials (a better treatment is pending founder review).
- **Brand without a cover**: brand ink + pitch, logo tile.
- **Product placeholders**: soft gradient + a stick glyph.

## Photos
- Real field hockey photos, landscape for covers, no text or posters, action over posed.
- Photo and category must match (no women's photo on a men's role).
- Third-party watermarked images are reference-only, never shipped.
- No autoplay video (cost and attention): tap to play.
- Synthetic / CG assets (the mascot) are labelled as such in provenance.
