// Generates PWA icons for Recall from an inline SVG mark (amber "ripple" glyph)
import sharp from 'sharp'
import { mkdirSync } from 'fs'

const OUT = '/home/z/my-project/public/icons'
mkdirSync(OUT, { recursive: true })

function rippleSvg({ rounded = true, pad = 0 } = {}) {
  const size = 512
  const rx = rounded ? 116 : 0
  const s = 1 - pad // content scale for maskable safe zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d97706"/>
      <stop offset="1" stop-color="#92400e"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${s}) translate(-256 -256)"
     stroke="#fffbeb" stroke-width="30" stroke-linecap="round" fill="none">
    <circle cx="256" cy="256" r="46"/>
    <path d="M 256 128 a 128 128 0 0 1 128 128" opacity="0.92"/>
    <path d="M 256 384 a 128 128 0 0 1 -128 -128" opacity="0.92"/>
    <path d="M 256 76 a 180 180 0 0 1 180 180" opacity="0.55"/>
    <path d="M 256 436 a 180 180 0 0 1 -180 -180" opacity="0.55"/>
  </g>
</svg>`
}

async function main() {
  for (const spec of [
    { file: 'icon-192.png', svg: rippleSvg(), size: 192 },
    { file: 'icon-512.png', svg: rippleSvg(), size: 512 },
    { file: 'maskable-512.png', svg: rippleSvg({ rounded: false, pad: 0.18 }), size: 512 },
  ]) {
    await sharp(Buffer.from(spec.svg)).resize(spec.size, spec.size).png().toFile(`${OUT}/${spec.file}`)
    console.log('wrote', spec.file)
  }
  await sharp(Buffer.from(rippleSvg())).resize(64, 64).png().toFile('/home/z/my-project/public/favicon.png')
  console.log('wrote favicon.png')
}

main().catch((e) => { console.error(e); process.exit(1) })
