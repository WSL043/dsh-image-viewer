import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = process.argv[2] ?? join(repo, '.artifacts', 'viewer-browser')
const clientPath = join(repo, 'lib', 'client.js')
const image = (width, height, fill) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
)}`
const normal = image(640, 480, '#2377aa'), normalTwo = image(640, 480, '#aa5523'), large = image(20_000, 1_000, '#5523aa')
const retryUrl = 'http://viewer.test/retry.svg'
const checks = [], pageErrors = []
let browser, page
const watchdog = setTimeout(() => { void browser?.close() }, 55_000)
const waitReady = async () => {
  await page.locator('.niv-image').waitFor({ state: 'visible' })
  await page.waitForFunction(() => { const img = document.querySelector('.niv-image'); return !!img && img.complete && img.naturalWidth > 0 })
}
try {
  await mkdir(evidence, { recursive: true })
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(4500)
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setContent('<main id="mount"></main>')
  await page.addScriptTag({ path: join(repo, 'node_modules', 'react', 'umd', 'react.development.js') })
  await page.addScriptTag({ path: join(repo, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js') })
  await page.evaluate(() => {
    const React = window.React
    const iconNames = ['IconChevronLeftOutline14', 'IconChevronRightOutline14', 'IconCloseOutline16', 'IconCopyOutline16', 'IconDownloadOutline16', 'IconEditOutline16', 'IconFullscreenOutline16']
    const Icon = () => React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
      React.createElement('path', { d: 'M2 8h12', stroke: 'currentColor', fill: 'none', strokeWidth: 1.5 }),
    )
    const primitives = Object.fromEntries(iconNames.map(name => [name, Icon]))
    const dictionaries = new Map()
    window.__ModuleLoader__ = {
      load(entry) {
        window.__viewerModule = entry.factory(specifier => {
          if (specifier === 'react') return React
          if (specifier === 'react/jsx-runtime') {
            const jsx = (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key })
            return { Fragment: React.Fragment, jsx, jsxs: jsx }
          }
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
          throw new Error(`Unexpected module: ${specifier}`)
        })
      },
    }
    window.__viewerContext = {
      locale: {
        register(name, locales) { dictionaries.set(name, locales) },
        bind(name) { return key => dictionaries.get(name)?.en?.[key] ?? key },
      },
      effect(effect) { return effect() },
      reflect: {
        provide(name, value) {
          window.__viewerService = value
          window.__viewerProvidedName = name
          return () => {}
        },
      },
      slots: {
        inject(_name, callback) { return callback() },
        register(options, component) {
          window.__viewerRegistration = { options, component }
          return () => {}
        },
      },
    }
  })
  await page.addScriptTag({ path: clientPath })
  await page.evaluate(() => {
    if (!window.__viewerModule || !window.ReactDOM?.createRoot) throw new Error('viewer harness did not initialize')
    window.__viewerModule.apply(window.__viewerContext)
    if (!window.__viewerRegistration) throw new Error('viewer slot was not registered')
    const props = window.__viewerRegistration.options.inject()
    window.__viewerRoot = window.ReactDOM.createRoot(document.querySelector('#mount'))
    window.__viewerRoot.render(window.React.createElement(window.__viewerRegistration.component, props))
  })
  const open = async (items, index = 0, openerId) => {
    await page.evaluate(({ items: requestItems, index: requestIndex, openerId: id }) => {
      window.__viewerService.open({ items: requestItems, index: requestIndex, opener: id ? document.getElementById(id) : undefined, source: 'browser-test', annotations: false })
    }, { items, index, openerId })
    await page.locator('.niv-root').waitFor({ state: 'visible' })
  }
  const close = async () => { await page.keyboard.press('Escape'); await page.locator('.niv-root').waitFor({ state: 'hidden' }) }
  await open([{ id: 'large', src: large, name: 'Wide synthetic image', width: 20_000, height: 1_000 }])
  await waitReady()
  await page.locator('.niv-root').getByRole('button', { name: '100%', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.niv-zoom')?.textContent === '100%')
  const largeMetrics = await page.evaluate(() => {
    const image = document.querySelector('.niv-image')
    return { naturalWidth: image.naturalWidth, renderedWidth: document.querySelector('.niv-surface').getBoundingClientRect().width }
  })
  assert.equal(largeMetrics.naturalWidth, 20_000)
  assert.ok(Math.abs(largeMetrics.renderedWidth - largeMetrics.naturalWidth) <= largeMetrics.naturalWidth * 0.02, `rendered width ${largeMetrics.renderedWidth} differs from natural width`)
  checks.push('large image actual size')
  await close()
  let attempts = 0
  await page.route(retryUrl, route => {
    attempts += 1
    return attempts === 1
      ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'synthetic 404' })
      : route.fulfill({ status: 200, contentType: 'image/svg+xml', body: decodeURIComponent(large.split(',')[1]) })
  })
  await open([{ id: 'retry', src: retryUrl, name: 'Retry image' }])
  const alert = page.locator('[role="alert"]')
  await alert.waitFor()
  assert.match(await alert.innerText(), /Image could not be loaded/u)
  await alert.getByRole('button', { name: 'Retry', exact: true }).click()
  await waitReady()
  assert.equal(attempts, 2, `retry requests: ${attempts}`)
  checks.push('error and retry')
  await page.evaluate(() => window.__viewerService.close())
  await page.locator('.niv-root').waitFor({ state: 'hidden' })
  await page.unroute(retryUrl)
  await page.evaluate(() => {
    const opener = document.createElement('button')
    opener.id = 'viewer-opener'
    opener.textContent = 'Open synthetic image'
    document.body.append(opener)
    opener.focus()
  })
  await open([{ id: 'focus', src: normal, name: 'Focus image' }], 0, 'viewer-opener')
  await waitReady()
  await page.waitForFunction(() => document.activeElement?.classList.contains('niv-root'))
  await page.keyboard.press('Shift+Tab')
  await page.waitForFunction(() => document.querySelector('.niv-root')?.contains(document.activeElement))
  assert.ok(await page.evaluate(() => document.querySelector('.niv-root').contains(document.activeElement)))
  await page.keyboard.press('Escape')
  await page.locator('.niv-root').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.id === 'viewer-opener')
  checks.push('focus trap and restoration')
  await page.evaluate(() => document.querySelector('#viewer-opener')?.remove())
  const switchItems = [
    { id: 'wide-switch', src: large, name: 'Wide before switch', width: 20_000, height: 1_000 },
    { id: 'normal-switch', src: normalTwo, name: 'Normal after switch', width: 640, height: 480 },
  ]
  await open(switchItems)
  await waitReady()
  await page.locator('.niv-root').getByRole('button', { name: '100%', exact: true }).click()
  const stage = page.locator('.niv-stage')
  const box = await stage.boundingBox()
  assert.ok(box)
  try {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 3 })
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('.niv-counter')?.textContent === '2 / 2')
    await waitReady()
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 80)
    const switched = await page.evaluate(() => ({
      alt: document.querySelector('.niv-image').alt,
      transform: document.querySelector('.niv-surface').style.transform,
      dragging: document.querySelector('.niv-stage').dataset.dragging,
    }))
    assert.equal(switched.alt, 'Normal after switch')
    assert.match(switched.transform, /translate3d\(0px,\s*0px,\s*0px\)\s*scale\(1\)/u)
    assert.equal(switched.dragging, 'false')
  } finally {
    await page.mouse.up().catch(() => {})
  }
  checks.push('switch resets transform and pointer state')
  await close()
  assert.deepEqual(pageErrors, [])
  const result = { ok: true, checks }
  await writeFile(join(evidence, 'viewer-browser-result.json'), `${JSON.stringify(result)}\n`, 'utf8')
  console.log(JSON.stringify(result))
} catch (error) {
  const result = { ok: false, checks, error: error instanceof Error ? error.message : String(error), pageErrors }
  await page?.screenshot({ path: join(evidence, 'viewer-browser-failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(evidence, 'viewer-browser-failure.json'), `${JSON.stringify(result)}\n`, 'utf8').catch(() => {})
  console.error(JSON.stringify(result))
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
  await browser?.close().catch(() => {})
}
