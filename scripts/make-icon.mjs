/**
 * Render the 180x180 storefront tile into `assets/icon-180.png`.
 *
 * The market asks for a GitHub-hosted raster image, and this machine has no
 * SVG rasterizer, so the PNG is encoded directly with zlib and a small CRC32
 * implementation — no dependency, reproducible from the same shapes as
 * `icon.svg`.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SIZE = 180
const SS = 4 // supersampling factor for the edges
const DIM = SIZE * SS

const BLUE = [47, 109, 246]
const VIOLET = [122, 60, 255]
const WHITE = [255, 255, 255]
const OFF_WHITE = [240, 244, 255]

/** Rounded rectangle: inside test with circular corners. */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1
}

/** Circle test. */
function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** Triangle test (same winding for all edges). */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** Colour of one supersample point, or null for transparent. */
function sample(x, y) {
  const unit = SIZE / DIM
  const px = x * unit
  const py = y * unit

  // Background: rounded square with a diagonal gradient.
  if (!inRoundRect(px, py, 6, 6, 174, 174, 40)) return null
  const t = Math.min(1, Math.max(0, (px + py) / (2 * 180)))
  const bg = [
    Math.round(BLUE[0] + (VIOLET[0] - BLUE[0]) * t),
    Math.round(BLUE[1] + (VIOLET[1] - BLUE[1]) * t),
    Math.round(BLUE[2] + (VIOLET[2] - BLUE[2]) * t),
  ]

  // Antenna: stem and dot above the bubble.
  if (inRoundRect(px, py, 87, 30, 93, 48, 3)) return WHITE
  if (inCircle(px, py, 90, 30, 9)) return WHITE

  // Chat bubble with a tail at the lower left, then the dots on top of it.
  if (inTriangle(px, py, 52, 126, 52, 156, 82, 130)) return OFF_WHITE
  if (inRoundRect(px, py, 32, 56, 148, 132, 26)) {
    if (inCircle(px, py, 66, 94, 8)) return BLUE
    if (inCircle(px, py, 90, 94, 8)) return [74, 91, 240]
    if (inCircle(px, py, 114, 94, 8)) return VIOLET
    return OFF_WHITE
  }

  return bg
}

const pixels = new Uint8Array(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0
    let g = 0
    let b = 0
    let hits = 0
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const colour = sample(x * SS + sx + 0.5, y * SS + sy + 0.5)
        if (colour === null) continue
        r += colour[0]
        g += colour[1]
        b += colour[2]
        hits += 1
      }
    }
    const offset = (y * SIZE + x) * 4
    if (hits === 0) continue
    pixels[offset] = Math.round(r / hits)
    pixels[offset + 1] = Math.round(g / hits)
    pixels[offset + 2] = Math.round(b / hits)
    pixels[offset + 3] = Math.round((hits / (SS * SS)) * 255)
  }
}

// --- minimal PNG encoder -----------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = ~0
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (~c) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(new URL('../assets/', import.meta.url), { recursive: true })
writeFileSync(new URL('../assets/icon-180.png', import.meta.url), png)
console.log(`wrote assets/icon-180.png (${png.length} bytes)`)
