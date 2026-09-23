import { deflateSync } from 'node:zlib'

// Electron's nativeImage decodes PNG and JPEG only: an SVG path or an
// `image/svg+xml` data URL always produces an empty image, which is why the
// tray fell back to a blank glyph on any host without the installed raster.
// Encoding a real PNG in-process removes that whole class of failure without
// adding a dependency, so the icon never depends on a host tool being present.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = new Int32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  CRC_TABLE[index] = value
}

function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, payload) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length, 0)
  header.write(type, 4, 'ascii')
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), payload])), 0)
  return Buffer.concat([header, payload, checksum])
}

// 8-bit RGBA, no interlacing, one filter byte per scanline (filter 0 = none).
export function encodePNG(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Invalid PNG dimensions')
  if (rgba.length !== width * height * 4) throw new Error('Invalid PNG pixel buffer')
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)
  for (let row = 0; row < height; row += 1) pixels.copy(raw, row * (stride + 1) + 1, row * stride, row * stride + stride)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
