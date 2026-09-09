import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkAnnotationZoom({ page, open, waitReady, normal, evidence }) {
  await open([{ id: 'annotation-zoom', src: normal, name: 'Annotation sharpness' }], 0, undefined, { annotations: true })
  await waitReady()
  await page.getByRole('button', { name: 'Mark region', exact: true }).click()
  await page.locator('.niv-image').click()
  await page.locator('.niv-inline-note textarea').fill('清晰标注 Annotation 123')
  await page.locator('.niv-root').focus()
  await page.evaluate(() => document.fonts.ready)
  const measurements = []
  let firstPin, firstNote, previousZoom = 1
  for (const zoom of [1, 1.75, 4, 8]) {
    if (zoom !== 1) {
      await page.locator('.niv-stage').hover()
      await page.mouse.wheel(0, -Math.log(zoom / previousZoom) / 0.0015)
      await page.waitForFunction(expected => {
        const value = document.querySelector('.niv-surface')?.style.transform.match(/scale\(([-\d.]+)\)/u)
        return Math.abs(Number(value?.[1]) - expected) < 0.001
      }, zoom)
    }
    previousZoom = zoom
    const pin = await page.locator('.niv-pin').screenshot()
    const note = await page.locator('.niv-inline-note').screenshot()
    firstPin ??= pin
    firstNote ??= note
    const geometry = await page.evaluate(() => {
      const pin = document.querySelector('.niv-pin'), image = document.querySelector('.niv-image')
      const marker = pin.getBoundingClientRect(), bounds = image.getBoundingClientRect()
      return { width: marker.width, height: marker.height,
        anchorError: Math.hypot(marker.x + marker.width / 2 - bounds.x - bounds.width / 2, marker.y + marker.height / 2 - bounds.y - bounds.height / 2),
        scaledAncestor: pin.closest('.niv-surface') !== null }
    })
    measurements.push({ zoom, ...geometry, identicalPinPixels: pin.equals(firstPin), identicalNotePixels: note.equals(firstNote) })
    if (zoom === 1 || zoom === 8) {
      const bounds = await page.locator('.niv-pin').boundingBox()
      await page.screenshot({ path: join(evidence, `annotation-${zoom}x.png`), clip: { x: Math.floor(bounds.x - 165), y: Math.floor(bounds.y - 100), width: 360, height: 160 } })
    }
  }
  await writeFile(join(evidence, 'annotation-zoom.json'), JSON.stringify(measurements, null, 2))
  for (const sample of measurements) {
    assert.equal(sample.scaledAncestor, false, 'annotations must not be composited inside the scaled image')
    assert.ok(Math.abs(sample.width - 24) < 0.01 && Math.abs(sample.height - 24) < 0.01)
    assert.ok(sample.anchorError <= 1)
    assert.equal(sample.identicalPinPixels, true, `pin raster changed at ${sample.zoom}x`)
    assert.equal(sample.identicalNotePixels, true, `note raster changed at ${sample.zoom}x`)
  }
  await page.mouse.move(740, 520)
  await page.mouse.down()
  await page.mouse.move(800, 560)
  await page.mouse.up()
  await page.setViewportSize({ width: 900, height: 700 })
  await page.waitForFunction(() => {
    const pin = document.querySelector('.niv-pin').getBoundingClientRect(), image = document.querySelector('.niv-image').getBoundingClientRect()
    return Math.hypot(pin.x + 12 - image.x - image.width / 2, pin.y + 12 - image.y - image.height / 2) <= 1
  })
  await page.locator('.niv-root').focus()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1200, height: 800 })
}
