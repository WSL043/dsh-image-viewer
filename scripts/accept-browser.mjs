import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'

async function dismissOfficialFirstRunOverlay(page) {
  const overlays = [
    {
      name: 'Internal Testing Notice / 内测声明',
      dialog: /^(Internal Testing Notice|内测声明)$/i,
      button: /^(Continue|继续)$/i,
    },
    {
      name: 'Preview Notice / 预览版说明',
      dialog: /^(Preview Notice|预览版说明)$/,
      button: /^(Continue|继续)$/,
    },
    {
      name: 'Add an API key to get started / 添加一个 API Key 开始使用',
      dialog: /^(Add an API key to get started|添加一个 API Key 开始使用)$/i,
      button: /^(Configure later|稍后配置)$/i,
    },
  ]

  let previewNoticeDismissed = false
  for (const firstRunOverlay of overlays) {
    const overlay = page.getByRole('dialog', { name: firstRunOverlay.dialog })
    if (!(await overlay.isVisible())) {
      if (previewNoticeDismissed && firstRunOverlay.name.startsWith('Add an API key')) {
        await overlay.waitFor({ state: 'visible', timeout: 5000 })
      } else {
        continue
      }
    }

    const closeButton = overlay.getByRole('button', { name: firstRunOverlay.button })
    if (await closeButton.count() !== 1) {
      throw new Error(`The visible official ${firstRunOverlay.name} overlay has no unique recognized button.`)
    }
    if (!(await closeButton.isVisible()) || !(await closeButton.isEnabled())) {
      throw new Error(`The official ${firstRunOverlay.name} overlay button is not visible and enabled.`)
    }

    await closeButton.click()
    await expect(overlay).toBeHidden()
    if (firstRunOverlay.name.startsWith('Preview Notice')) previewNoticeDismissed = true
  }
}

const [url, evidence] = process.argv.slice(2)
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: process.env.DSH_TEST_BROWSER_CHANNEL || undefined })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const notice = page.getByRole('dialog', { name: /Internal Testing Notice|内测声明/ })
  await notice.waitFor({ timeout: 5000 }).catch(() => {})
  await dismissOfficialFirstRunOverlay(page)
  const session = page.locator('[role="treeitem"]').filter({ has: page.locator('button[aria-label^="Session actions for "],button[aria-label^="会话“"]') }).first()
  // Newer DSH can already select a blank workspace session without a row menu.
  if (await session.count()) await session.click()
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
  await input.fill('Existing acceptance draft')
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
  await page.screenshot({ path: join(evidence, 'official-viewer-annotation.png') })
  await viewer.getByRole('button', { name: /^(Remove region note|删除区域备注)$/ }).click()
  assert.equal(await viewer.locator('.niv-annotation').count(), 0)
  const downloaded = page.waitForEvent('download')
  await viewer.locator('.niv-download').click()
  const download = await downloaded
  assert.equal(await download.failure(), null)
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.matches('[role="group"] button[title], [role="group"] button[title] *'))
  // Keep this in the actual DSH acceptance: drawing alone did not exercise
  // the host's current-session or attachment APIs.
  await thumbnails.nth(1).click()
  await viewer.waitFor()
  await viewer.getByRole('button', { name: /^(Mark region|标记区域)$/ }).click()
  await viewer.locator('.niv-image').click()
  await viewer.locator('textarea').fill('Annotation returned to the original draft')
  await viewer.locator('.niv-close-floating').click()
  await viewer.waitFor({ state: 'hidden' })
  await thumbnails.nth(2).waitFor()
  assert.equal(await thumbnails.count(), 3, 'marked image is appended to the composer')
  const draft = await input.innerText()
  assert.ok(draft.includes('Existing acceptance draft'), 'existing draft is preserved')
  assert.ok(draft.includes('Annotation returned to the original draft'), 'notes return to the composer')
  await page.screenshot({ path: join(evidence, 'official-viewer-annotation-draft.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['official composer attachments', 'gallery index and navigation', 'zoom', 'pan', 'region note add/remove', 'download', 'escape and focus', 'annotation image and notes returned to draft', 'no page errors'] }))
} catch (error) {
  await page.screenshot({ path: join(evidence, 'browser-failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'browser-failure.html'), await page.content())
  await writeFile(join(evidence, 'browser-errors.json'), JSON.stringify(errors))
  throw error
} finally {
  await browser.close()
}
