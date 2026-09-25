import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import tauriConfig from '../../src-tauri/tauri.conf.json'

const root = resolve(__dirname, '../..')
const logo = resolve(root, 'src/assets/logo')
const iosIcons = resolve(root, 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset')

// A PNG's size, and whether it can be transparent: an alpha channel (colour
// types 4 and 6) or a tRNS chunk
function png(path) {
  const bytes = readFileSync(path)
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  const chunks = []
  for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    chunks.push(bytes.subarray(at + 4, at + 8).toString('ascii'))
  }
  const colourType = bytes[25]
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    alpha: colourType === 4 || colourType === 6 || chunks.includes('tRNS'),
  }
}

describe("the app's icons", () => {
  it('has every icon tauri.conf.json lists, the PNGs at the sizes their names give', () => {
    for (const icon of tauriConfig.bundle.icon) {
      const path = resolve(root, 'src-tauri', icon)
      expect(existsSync(path), icon).toBe(true)
      const [, size, retina] = icon.match(/(\d+)x\d+(@2x)?\.png$/) ?? []
      if (size) {
        const side = Number(size) * (retina ? 2 : 1)
        expect(png(path), icon).toMatchObject({ width: side, height: side })
      }
    }
  })

  it("keeps the iOS app's icon set, every icon at its size and without an alpha channel", () => {
    // tauri ios init writes Tauri's own icons into the iOS project, which is
    // not in git, but leaves files that exist alone: so the set is kept in
    // git. The App Store refuses an app icon with an alpha channel.
    const { images } = JSON.parse(readFileSync(resolve(iosIcons, 'Contents.json'), 'utf-8'))
    const named = new Set(images.map((image) => image.filename))
    expect([...named].sort()).toEqual(readdirSync(iosIcons).filter((f) => f.endsWith('.png')).sort())
    expect(images.some((image) => image.idiom === 'ios-marketing' && image.size === '1024x1024')).toBe(true)

    for (const { filename, size, scale } of images) {
      const side = Number(size.split('x')[0]) * Number(scale.replace('x', ''))
      expect(png(resolve(iosIcons, filename)), filename).toEqual({ width: side, height: side, alpha: false })
    }
  })

  it('gives the page the logo as its icon', () => {
    const page = new DOMParser().parseFromString(readFileSync(resolve(root, 'index.html'), 'utf-8'), 'text/html')
    const icons = [...page.querySelectorAll('link[rel="icon"]')].map((link) => link.getAttribute('href'))
    expect(icons).toEqual(['/src/assets/logo/symbol-32.svg', '/src/assets/logo/symbol-32.png'])
    for (const icon of icons) expect(existsSync(resolve(root, icon.slice(1))), icon).toBe(true)
    expect(png(resolve(root, icons[1].slice(1)))).toMatchObject({ width: 32, height: 32 })
  })

  it('keeps the logo as plain SVGs: no text, fonts, masks, images, styles or links to other files', () => {
    const svgs = readdirSync(logo).filter((f) => f.endsWith('.svg'))
    expect(svgs.length).toBeGreaterThanOrEqual(9)
    for (const svg of svgs) {
      const source = readFileSync(resolve(logo, svg), 'utf-8')
      expect(source, svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[^"]+"/)
      expect(source, svg).not.toMatch(/<(text|font|mask|clipPath|filter|image|style|use|script|foreignObject)\b|href|url\(/)
    }
  })
})
