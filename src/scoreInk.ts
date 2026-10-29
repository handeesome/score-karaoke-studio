import type { Region, ScorePage } from './types'

interface InkPage { width: number; height: number; pixels: Uint8ClampedArray }
interface InkBand { top: number; bottom: number; mass: number }

export async function loadInkPage(page: ScorePage): Promise<InkPage> {
  const image = new Image()
  image.src = page.image
  await image.decode()
  const scale = Math.min(1, 1600 / image.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法读取乐谱图片')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  if (page.inverted) for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i]; pixels[i + 1] = 255 - pixels[i + 1]; pixels[i + 2] = 255 - pixels[i + 2]
  }
  return { width: canvas.width, height: canvas.height, pixels }
}

function inkBands(page: InkPage, region: Region, top: number, bottom: number): InkBand[] {
  const left = Math.max(0, Math.floor(region.x * page.width))
  const right = Math.min(page.width, Math.ceil((region.x + region.width) * page.width))
  const firstRow = Math.max(0, Math.floor(top))
  const lastRow = Math.min(page.height, Math.ceil(bottom))
  const minimumInk = Math.max(2, Math.round((right - left) * .012))
  const bands: InkBand[] = []
  let current: InkBand | null = null
  for (let y = firstRow; y < lastRow; y++) {
    let count = 0
    for (let x = left; x < right; x++) {
      const offset = (y * page.width + x) * 4
      const red = page.pixels[offset]
      const green = page.pixels[offset + 1]
      const blue = page.pixels[offset + 2]
      if (red * .299 + green * .587 + blue * .114 < 150) count++
    }
    if (count >= minimumInk) {
      if (!current || y - current.bottom > 2) {
        current = { top: y, bottom: y + 1, mass: count }
        bands.push(current)
      } else {
        current.bottom = y + 1
        current.mass += count
      }
    }
  }
  return bands
}

export function copyRegionToNextLine(page: InkPage, region: Region): Region | null {
  const boxTop = region.y * page.height
  const boxBottom = (region.y + region.height) * page.height
  const source = inkBands(page, region, boxTop, boxBottom)
    .filter(band => band.bottom - band.top >= Math.max(4, region.height * page.height * .28))
    .sort((a, b) => b.mass - a.mass)[0]
  if (!source) return null

  const textHeight = source.bottom - source.top
  const topPadding = Math.max(0, source.top - boxTop)
  const bottomPadding = Math.max(0, boxBottom - source.bottom)
  const candidates = inkBands(page, region,
    source.top + textHeight * 1.15,
    source.top + textHeight * 3.7)
    .filter(band => band.top >= source.top + textHeight * 1.15
      && band.top <= source.top + textHeight * 2.7
      && band.bottom - band.top >= textHeight * .6
      && band.bottom - band.top <= textHeight * 1.65
      && band.mass >= source.mass * .3)
  const target = candidates[0]
  if (!target) return null

  const y = (target.top - topPadding) / page.height
  const height = (target.bottom - target.top + topPadding + bottomPadding) / page.height
  if (y < 0 || y + height > 1) return null
  return { ...region, y, height }
}
