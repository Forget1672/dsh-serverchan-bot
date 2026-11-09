/**
 * Render the market/inventory PNGs from `icon.svg`.
 *
 *   npm i --no-save @resvg/resvg-js    # one-off rasterizer, not a runtime dependency
 *   node scripts/render-icon.mjs
 *
 * `assets/icon-180.png` is the dshmarket storefront tile.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

let Resvg
try {
  Resvg = createRequire(import.meta.url)('@resvg/resvg-js').Resvg
} catch {
  console.error('render-icon: install the rasterizer first: npm i --no-save @resvg/resvg-js')
  process.exit(1)
}

const root = new URL('../', import.meta.url)
const svg = readFileSync(new URL('icon.svg', root))

for (const [size, file] of [[180, 'assets/icon-180.png']]) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  }).render().asPng()
  writeFileSync(new URL(file, root), png)
  console.log(`${file} (${size}px, ${png.length} bytes)`)
}
