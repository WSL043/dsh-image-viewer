import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const [url, evidence] = process.argv.slice(2)
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const notice = page.getByRole('dialog', { name: /Internal Testing Notice|内测声明/ })
  await notice.waitFor({ timeout: 5000 }).catch(() => {})
  // Only the isolated, keyless fixture skips onboarding; actual image UI stays intact.
  for (const dialog of await page.getByRole('dialog').all()) {
    if (!/Internal Testing Notice|内测声明|API Key|密钥/i.test(await dialog.innerText())) continue
    await dialog.evaluate(element => {
      ;(element.parentElement ?? element).remove()
      for (const inert of document.querySelectorAll('[inert]')) inert.removeAttribute('inert')
    })
  }
  const session = page.locator('[role="treeitem"]').filter({ has: page.locator('button[aria-label^="Session actions for "],button[aria-label^="会话“"]') }).first()
  await session.click()
  const fixtures = await page.evaluate(() => ['#2377aa', '#aa5523'].map(color => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 640, 480)
    return canvas.toDataURL('image/png').split(',')[1]
  }))
  const clipboard = await page.evaluateHandle(images => {
    const data = new DataTransfer()
    images.forEach((png, index) => data.items.add(new File([
      Uint8Array.from(atob(png), c => c.charCodeAt(0)),
    ], `fixture-${index}.png`, { type: 'image/png' })))
    return data
  }, fixtures)
  const input = page.locator('[contenteditable="true"][role="textbox"]')
  await input.click()
  await input.evaluate((element, clipboardData) => element.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData,
  })), clipboard)
  await clipboard.dispose()
  const thumbnails = page.locator('[role="group"] button[title]').filter({ has: page.locator(':scope > img') })
  await thumbnails.nth(1).waitFor()
  await thumbnails.nth(1).click()
  const viewer = page.locator('.niv-root')
  await viewer.waitFor()
  await page.waitForFunction(() => document.querySelector('.niv-counter')?.textContent === '2 / 2')
  await viewer.getByRole('button', { name: /^(Previous image|上一张图片)$/ }).click()
  await page.waitForFunction(() => document.querySelector('.niv-counter')?.textContent === '1 / 2')
  await viewer.getByRole('button', { name: /^(Next image|下一张图片)$/ }).click()
  await page.waitForFunction(() => document.querySelector('.niv-counter')?.textContent === '2 / 2')
  const before = await viewer.locator('.niv-zoom').innerText()
  await viewer.locator('.niv-stage').hover()
  // Make the fixture larger than the stage so pan exercises real overflow.
  await page.mouse.wheel(0, -800)
  await page.waitForFunction(value => document.querySelector('.niv-zoom')?.textContent !== value, before)
  const surface = viewer.locator('.niv-surface')
  const transform = await surface.getAttribute('style')
  const bounds = await viewer.locator('.niv-stage').boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  assert.notEqual(await surface.getAttribute('style'), transform)
  await viewer.getByRole('button', { name: /^(Fit|适应窗口)$/ }).click()
  await viewer.getByRole('button', { name: /^(Mark region|标记区域)$/ }).click()
  await viewer.locator('.niv-image').click()
  await viewer.locator('textarea').fill('Synthetic acceptance note')
  await viewer.getByRole('button', { name: /^(Remove region note|删除区域备注)$/ }).click()
  assert.equal(await viewer.locator('.niv-annotation').count(), 0)
  const downloaded = page.waitForEvent('download')
  await viewer.locator('.niv-download').click()
  const download = await downloaded
  assert.equal(await download.failure(), null)
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.matches('[role="group"] button[title], [role="group"] button[title] *'))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['official composer attachments', 'gallery index and navigation', 'zoom', 'pan', 'region note add/remove', 'download', 'escape and focus', 'no page errors'] }))
} catch (error) {
  await page.screenshot({ path: join(evidence, 'browser-failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'browser-failure.html'), await page.content())
  await writeFile(join(evidence, 'browser-errors.json'), JSON.stringify(errors))
  throw error
} finally {
  await browser.close()
}
