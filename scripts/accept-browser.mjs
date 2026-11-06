import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { prepareEvidenceDirectory, evidenceFile, writeEvidence } from './evidence-paths.mjs'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'

async function dismissOfficialFirstRunOverlayOnce(page) {
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
  let dismissedAny = false
  for (const firstRunOverlay of overlays) {
    const overlay = page.getByRole('dialog', { name: firstRunOverlay.dialog })
    if (!(await overlay.isVisible())) {
      if (previewNoticeDismissed && firstRunOverlay.name.startsWith('Add an API key')) {
        // Newer official cores may show no API key step, or a sign-in step instead; the generic pass below handles those.
        if (!(await overlay.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) continue
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
    dismissedAny = true
    if (firstRunOverlay.name.startsWith('Preview Notice')) previewNoticeDismissed = true
  }
  // Any other first-run dialog (for example a sign-in step) is closed through its own dismiss button.
  const other = page.locator('[role="dialog"]:visible').last()
  if (await other.count()) {
    const dismiss = other.getByRole('button', { name: /^(Close|关闭|Configure later|稍后配置|Set up later|Skip|跳过|Continue|继续)$/i })
    if (await dismiss.count() >= 1) {
      await dismiss.first().click()
      dismissedAny = true
    }
  }
  return dismissedAny
}

// The official first-run notices can appear a moment after the page loads, so keep dismissing until
// nothing is dismissed and no dialog is visible on two consecutive checks.
async function dismissOfficialFirstRunOverlay(page) {
  let quietChecks = 0
  for (let pass = 0; pass < 12 && quietChecks < 2; pass += 1) {
    const dismissed = await dismissOfficialFirstRunOverlayOnce(page)
    const dialogVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
    quietChecks = !dismissed && !dialogVisible ? quietChecks + 1 : 0
    await page.waitForTimeout(dismissed ? 400 : 800)
  }
}

const [url, requestedEvidence] = process.argv.slice(2)
const target = new URL(url)
assert.ok(target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port && !target.username && !target.password, 'official acceptance requires a loopback HTTP target')
const evidence = await prepareEvidenceDirectory(requestedEvidence)
const browser = await chromium.launch({ headless: true, executablePath: process.env.DSH_TEST_BROWSER_EXECUTABLE || undefined, channel: process.env.DSH_TEST_BROWSER_EXECUTABLE ? undefined : process.env.DSH_TEST_BROWSER_CHANNEL || undefined })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: process.env.DSH_ACCEPTANCE_LOCALE || 'en-US' })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const notice = page.getByRole('dialog', { name: /Internal Testing Notice|内测声明/ })
  await notice.waitFor({ timeout: 5000 }).catch(() => {})
  await dismissOfficialFirstRunOverlay(page)
  await page.getByRole('button', { name: /^(View options|视图选项)$/ }).click()
  await page.getByRole('menu').getByText(/^(In one list|单列表)$/).click()
  await page.getByRole('treeitem').filter({ has: page.getByText('Image viewer acceptance', { exact: true }) }).click()
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
  const officialPreview = page.getByRole('dialog').last()
  await expect(officialPreview).toBeVisible()
  assert.equal(await page.locator('.niv-root').count(), 0, 'normal clicks keep the official preview')
  await page.keyboard.press('Escape')
  await expect(officialPreview).toBeHidden()
  const messageImage = page.locator('button[data-variant="single"],button[data-variant="tile"]').filter({ has: page.locator('img') }).nth(1)
  await messageImage.waitFor()
  await messageImage.focus()
  await messageImage.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^(Annotate image|标注图片)$/ }).click()
  const viewer = page.locator('.niv-root')
  await viewer.waitFor()
  assert.equal(await viewer.locator('.niv-counter').count(), 0, 'one explicit image is annotated')
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
  await page.screenshot({ path: await evidenceFile(evidence, 'official-viewer-annotation.png') })
  await viewer.getByRole('button', { name: /^(Remove region note|删除区域备注)$/ }).click()
  assert.equal(await viewer.locator('.niv-annotation').count(), 0)
  const downloaded = page.waitForEvent('download')
  await viewer.locator('.niv-download').click()
  const download = await downloaded
  assert.equal(await download.failure(), null)
  const originalBytes = await messageImage.locator('img').evaluate(async image => [...new Uint8Array(await (await fetch(image.currentSrc)).arrayBuffer())])
  const saved = await evidenceFile(evidence, 'official-image-download.png')
  await download.saveAs(saved)
  assert.deepEqual(await readFile(saved), Buffer.from(originalBytes), 'the actual downloaded file matches the displayed original')
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
  await expect(messageImage).toBeFocused()
  // Keep this in the actual DSH acceptance: drawing alone did not exercise
  // the host's current-session or attachment APIs.
  await messageImage.focus()
  await messageImage.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^(Annotate image|标注图片)$/ }).click()
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
  await page.screenshot({ path: await evidenceFile(evidence, 'official-viewer-annotation-draft.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, checks: ['official composer attachments', 'official preview retained and explicit image-menu annotation', 'zoom', 'pan', 'region note add/remove', 'downloaded file bytes verified', 'escape and focus', 'annotation image and notes returned to draft', 'no page errors'] }))
} catch (error) {
  await page.screenshot({ path: await evidenceFile(evidence, 'browser-failure.png') }).catch(() => {})
  await writeEvidence(evidence, 'browser-failure.html', await page.content())
  await writeEvidence(evidence, 'browser-errors.json', JSON.stringify(errors))
  throw error
} finally {
  await browser.close()
}
