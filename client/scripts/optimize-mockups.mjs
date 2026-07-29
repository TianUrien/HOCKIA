/**
 * One-shot: recompress the landing mockups (q82 was export-default heavy for
 * UI screenshots; q62 is visually identical at these display sizes) and emit
 * 480w variants for the hero pair, which render at ≤560px (desktop) and
 * ~342px (mobile) anyway.
 */
import sharp from 'sharp'
const jobs = [
  { src: 'public/Mockup5.webp', out: 'public/Mockup5.webp', width: null },
  { src: 'public/Mockup5.webp', out: 'public/Mockup5-480.webp', width: 480 },
  { src: 'public/Mockup4.webp', out: 'public/Mockup4.webp', width: null },
  { src: 'public/Mockup4.webp', out: 'public/Mockup4-360.webp', width: 360 },
]
for (const j of jobs) {
  const buf = await sharp(j.src).resize(j.width ? { width: j.width } : undefined).webp({ quality: 62, effort: 6 }).toBuffer()
  const { default: fs } = await import('node:fs/promises')
  await fs.writeFile(j.out, buf)
  console.log(j.out, Math.round(buf.length / 1024) + 'KB')
}
