import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { checkAnnotationZoom } from './annotation-zoom-check.mjs'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = process.argv[2] ?? join(repo, '.artifacts', 'viewer-browser')
const clientPath = join(repo, 'lib', 'client.js')
const image = (width, height, fill) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
)}`
const normal = image(640, 480, '#2377aa'), normalTwo = image(640, 480, '#aa5523'), large = image(20_000, 1_000, '#5523aa')
const plainBody = decodeURIComponent(normal.split(',')[1])
const retryUrl = 'http://viewer.test/retry.svg'
const checks = [], pageErrors = []
let browser, page, httpServer
const watchdog = setTimeout(() => { void browser?.close() }, 120_000)
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
  await page.evaluate(() => {
    if (typeof crypto.randomUUID !== 'function') {
      let sequence = 0
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `browser-test-${++sequence}` })
    }
  })
  // Functions cannot cross page.evaluate's structured-clone boundary. Compile
  // small, test-owned functions in the page and refer to them by name in
  // serializable viewer requests.
  const evaluatePage = async (callback, ...args) => page.evaluate(({ source, args: callbackArgs }) => {
    const fn = (0, eval)(`(${source})`)
    return fn(...callbackArgs)
  }, { source: callback.toString(), args })
  const registerPageCallbacks = async callbacks => {
    const sources = Object.fromEntries(Object.entries(callbacks).map(([name, callback]) => [name, callback.toString()]))
    await evaluatePage(function installCallbacks(nextSources) {
      const compile = source => (0, eval)(`(${source})`)
      window.__viewerCallbacks = Object.fromEntries(Object.entries(nextSources).map(([name, source]) => [name, compile(source)]))
    }, sources)
  }
  const encodeItems = items => items.map(item => {
    const encoded = { ...item }
    if (item.download?.callback) {
      const { callback, ...download } = item.download
      encoded.download = { ...download, onInvoke: `__viewer_callback__${callback}` }
    }
    if (Array.isArray(item.actions)) {
      encoded.actions = item.actions.map(action => {
        if (!action.callback) return { ...action }
        const { callback, ...rest } = action
        return { ...rest, onInvoke: `__viewer_callback__${callback}` }
      })
    }
    return encoded
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
  const open = async (items, index = 0, openerId, { annotations = false } = {}) => {
    await page.evaluate(({ items: requestItems, index: requestIndex, openerId: id, annotations: withAnnotations }) => {
      const resolveCallbacks = item => {
        const resolved = { ...item }
        const resolve = value => typeof value?.onInvoke === 'string' && value.onInvoke.startsWith('__viewer_callback__')
          ? { ...value, onInvoke: window.__viewerCallbacks?.[value.onInvoke.slice('__viewer_callback__'.length)] }
          : value
        if (resolved.download !== undefined) resolved.download = resolve(resolved.download)
        if (Array.isArray(resolved.actions)) resolved.actions = resolved.actions.map(resolve)
        return resolved
      }
      window.__viewerService.open({ items: requestItems.map(resolveCallbacks), index: requestIndex, opener: id ? document.getElementById(id) : undefined, source: 'browser-test', annotations: withAnnotations })
    }, { items: encodeItems(items), index, openerId, annotations })
    await page.locator('.niv-root').waitFor({ state: 'visible' })
    const expected = items[index]
    await page.waitForFunction(({ name, src }) => {
      const image = document.querySelector('.niv-image')
      return document.querySelector('.niv-title strong')?.textContent === name && image?.getAttribute('src') === src
    }, { name: expected.name, src: expected.src })
  }
  const close = async () => { await page.locator('.niv-root').focus(); await page.keyboard.press('Escape'); await page.locator('.niv-root').waitFor({ state: 'hidden' }) }
  await checkAnnotationZoom({ page, open, waitReady, normal, evidence })
  checks.push('annotation raster stays sharp across zoom with pan and resize anchoring')
  const waitCounter = expected => page.waitForFunction(value => document.querySelector('.niv-counter')?.textContent === value, expected)
  const waitImageAlt = expected => page.waitForFunction(value => document.querySelector('.niv-image')?.alt === value, expected)
  const readTransform = () => page.evaluate(() => {
    const surface = document.querySelector('.niv-surface')
    const stage = document.querySelector('.niv-stage')
    const match = surface?.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*[-\d.]+px\)\s*scale\(([-\d.]+)\)/u)
    const zoom = Number(match?.[3])
    return {
      x: Number(match?.[1]), y: Number(match?.[2]), zoom,
      limitX: surface && stage ? Math.max(0, (surface.offsetWidth * zoom - stage.clientWidth) / 2) : Number.NaN,
      limitY: surface && stage ? Math.max(0, (surface.offsetHeight * zoom - stage.clientHeight) / 2) : Number.NaN,
      style: surface?.style.transform,
    }
  })
  const dispatchTouchPointer = async (type, pointerId, x, y) => evaluatePage(function dispatch(pointer) {
    const stage = document.querySelector('.niv-stage')
    const original = Element.prototype.setPointerCapture
    Element.prototype.setPointerCapture = function () {}
    try {
      stage.dispatchEvent(new PointerEvent(pointer.type, {
        bubbles: true, cancelable: true, pointerId: pointer.id, pointerType: 'touch',
        isPrimary: pointer.id === 1, clientX: pointer.x, clientY: pointer.y,
        button: pointer.type === 'pointerdown' ? 0 : -1, buttons: pointer.type === 'pointerup' ? 0 : 1,
      }))
    } finally { Element.prototype.setPointerCapture = original }
  }, { type, id: pointerId, x, y })

  const galleryItems = [
    { id: 'gallery-first', src: normal, name: 'Gallery first', width: 640, height: 480 },
    { id: 'gallery-second', src: normalTwo, name: 'Gallery second', width: 640, height: 480 },
    { id: 'gallery-third', src: large, name: 'Gallery third', width: 20_000, height: 1_000 },
  ]
  await open(galleryItems)
  await waitReady()
  const gallery = page.locator('.niv-root')
  await waitCounter('1 / 3')
  await gallery.focus()
  await page.keyboard.press('ArrowRight')
  await waitCounter('2 / 3')
  await page.keyboard.press('ArrowRight')
  await waitCounter('3 / 3')
  await page.keyboard.press('ArrowRight')
  await waitCounter('1 / 3')
  await page.keyboard.press('ArrowLeft')
  await waitCounter('3 / 3')
  await gallery.getByRole('button', { name: 'Next image', exact: true }).click()
  await waitCounter('1 / 3')
  await gallery.getByRole('button', { name: 'Previous image', exact: true }).click()
  await waitCounter('3 / 3')
  checks.push('gallery keyboard wrap and navigation buttons')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(evidence, 'viewer-browser-dark.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: join(evidence, 'viewer-browser-light.png'), fullPage: true })
  await page.setViewportSize({ width: 580, height: 800 })
  await page.waitForFunction(() => window.innerWidth === 580 && document.querySelector('.niv-root')?.getBoundingClientRect().width === 580)
  const narrowMetrics = await page.evaluate(() => ({
    width: window.innerWidth,
    stageWidth: document.querySelector('.niv-stage')?.getBoundingClientRect().width,
    imageWidth: document.querySelector('.niv-image')?.getBoundingClientRect().width,
  }))
  assert.equal(narrowMetrics.width, 580)
  assert.ok(narrowMetrics.stageWidth > 0 && narrowMetrics.imageWidth <= 556.5, JSON.stringify(narrowMetrics))
  await page.screenshot({ path: join(evidence, 'viewer-browser-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForFunction(() => window.innerWidth === 1200 && document.querySelector('.niv-root')?.getBoundingClientRect().width === 1200)
  checks.push('dark light and narrow viewport screenshots')
  await close()

  await open([{ id: 'large', src: large, name: 'Wide synthetic image', width: 20_000, height: 1_000 }])
  await waitReady()
  const largeViewer = page.locator('.niv-root')
  const fitButton = largeViewer.getByRole('button', { name: 'Fit', exact: true })
  const actualButton = largeViewer.getByRole('button', { name: '100%', exact: true })
  await actualButton.click()
  await page.waitForFunction(() => document.querySelector('.niv-zoom')?.textContent === '100%')
  const largeMetrics = await page.evaluate(() => {
    const image = document.querySelector('.niv-image')
    return { naturalWidth: image.naturalWidth, renderedWidth: document.querySelector('.niv-surface').getBoundingClientRect().width }
  })
  assert.equal(largeMetrics.naturalWidth, 20_000)
  assert.ok(Math.abs(largeMetrics.renderedWidth - largeMetrics.naturalWidth) <= largeMetrics.naturalWidth * 0.02, `rendered width ${largeMetrics.renderedWidth} differs from natural width`)
  checks.push('large image actual size')
  await fitButton.click()
  await page.waitForFunction(() => document.querySelector('.niv-surface')?.style.transform.endsWith('scale(1)'))
  const fitZoom = Number((await largeViewer.locator('.niv-zoom').innerText()).replace('%', ''))
  await largeViewer.focus()
  await page.keyboard.press('+')
  await page.waitForFunction(value => Number(document.querySelector('.niv-zoom')?.textContent.replace('%', '')) > value, fitZoom)
  const plusZoom = Number((await largeViewer.locator('.niv-zoom').innerText()).replace('%', ''))
  await page.keyboard.press('-')
  await page.waitForFunction(value => Number(document.querySelector('.niv-zoom')?.textContent.replace('%', '')) < value, plusZoom)
  await fitButton.click()
  await page.waitForFunction(() => document.querySelector('.niv-surface')?.style.transform.endsWith('scale(1)'))
  const transformStage = largeViewer.locator('.niv-stage')
  await transformStage.dblclick()
  await page.waitForFunction(() => document.querySelector('.niv-zoom')?.textContent === '100%')
  await transformStage.dblclick()
  await page.waitForFunction(() => document.querySelector('.niv-surface')?.style.transform.endsWith('scale(1)'))
  await largeViewer.focus()
  await page.keyboard.press('+')
  await page.waitForFunction(() => {
    const match = document.querySelector('.niv-surface')?.style.transform.match(/scale\(([-\d.]+)\)/u)
    return Number(match?.[1]) > 1
  })
  const transformBox = await transformStage.boundingBox()
  assert.ok(transformBox)
  const dragToStageEdge = async direction => {
    const x = direction > 0 ? transformBox.x + transformBox.width - 2 : transformBox.x + 2
    await page.mouse.move(transformBox.x + transformBox.width / 2, transformBox.y + transformBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, transformBox.y + transformBox.height / 2)
    await page.mouse.up()
  }
  try {
    await dragToStageEdge(1)
    await page.waitForFunction(() => document.querySelector('.niv-stage')?.dataset.dragging === 'false')
  } finally { await page.mouse.up().catch(() => {}) }
  const rightPan = await readTransform()
  assert.ok(rightPan.x > 0 && rightPan.x <= rightPan.limitX + 1, JSON.stringify(rightPan))
  try {
    await dragToStageEdge(-1)
    await page.waitForFunction(() => document.querySelector('.niv-stage')?.dataset.dragging === 'false')
  } finally { await page.mouse.up().catch(() => {}) }
  const leftPan = await readTransform()
  assert.ok(leftPan.x < 0 && leftPan.x >= -leftPan.limitX - 1, JSON.stringify(leftPan))
  checks.push('fit actual keyboard zoom double click and bounded pan')

  await fitButton.click()
  await page.waitForFunction(() => document.querySelector('.niv-surface')?.style.transform.endsWith('scale(1)'))
  const wheelBefore = (await readTransform()).zoom
  const wheelBox = await transformStage.boundingBox()
  assert.ok(wheelBox)
  await evaluatePage(function dispatchWheel(point) {
    document.querySelector('.niv-stage').dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -1, deltaMode: 1,
      clientX: point.x, clientY: point.y,
    }))
  }, { x: wheelBox.x + wheelBox.width / 2, y: wheelBox.y + wheelBox.height / 2 })
  await page.waitForFunction(value => {
    const match = document.querySelector('.niv-surface')?.style.transform.match(/scale\(([-\d.]+)\)/u)
    return Number(match?.[1]) > value
  }, wheelBefore)
  checks.push('simulated wheel delta mode')
  await fitButton.click()
  await page.waitForFunction(() => document.querySelector('.niv-surface')?.style.transform.endsWith('scale(1)'))
  const touchCenter = { x: wheelBox.x + wheelBox.width / 2, y: wheelBox.y + wheelBox.height / 2 }
  const touchBefore = (await readTransform()).zoom
  await dispatchTouchPointer('pointerdown', 1, touchCenter.x - 20, touchCenter.y)
  await dispatchTouchPointer('pointerdown', 2, touchCenter.x + 20, touchCenter.y)
  await dispatchTouchPointer('pointermove', 2, touchCenter.x + 80, touchCenter.y)
  await page.waitForFunction(value => {
    const match = document.querySelector('.niv-surface')?.style.transform.match(/scale\(([-\d.]+)\)/u)
    return Number(match?.[1]) > value
  }, touchBefore)
  await dispatchTouchPointer('pointerup', 2, touchCenter.x + 80, touchCenter.y)
  await dispatchTouchPointer('pointermove', 1, touchCenter.x + 160, touchCenter.y)
  await page.waitForFunction(() => document.querySelector('.niv-stage')?.dataset.dragging === 'true')
  await dispatchTouchPointer('pointerup', 1, touchCenter.x + 160, touchCenter.y)
  await page.waitForFunction(() => document.querySelector('.niv-stage')?.dataset.dragging === 'false')
  checks.push('simulated touch pinch to one finger pan')
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
  const switchViewer = page.locator('.niv-root')
  await switchViewer.getByRole('button', { name: '100%', exact: true }).click()
  const switchStage = switchViewer.locator('.niv-stage')
  const switchBox = await switchStage.boundingBox()
  assert.ok(switchBox)
  try {
    await page.mouse.move(switchBox.x + switchBox.width / 2, switchBox.y + switchBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(switchBox.x + switchBox.width / 2 + 80, switchBox.y + switchBox.height / 2 + 40, { steps: 3 })
    await page.keyboard.press('ArrowRight')
    await waitCounter('2 / 2')
    await waitImageAlt('Normal after switch')
    await waitReady()
    await page.waitForFunction(() => /translate3d\(0px,\s*0px,\s*0px\)\s*scale\(1\)/u.test(document.querySelector('.niv-surface')?.style.transform ?? '') && document.querySelector('.niv-stage')?.dataset.dragging === 'false')
    const switched = await page.evaluate(() => ({
      alt: document.querySelector('.niv-image').alt,
      transform: document.querySelector('.niv-surface').style.transform,
      dragging: document.querySelector('.niv-stage').dataset.dragging,
    }))
    assert.equal(switched.alt, 'Normal after switch')
    assert.match(switched.transform, /translate3d\(0px,\s*0px,\s*0px\)\s*scale\(1\)/u)
    assert.equal(switched.dragging, 'false')
  } finally { await page.mouse.up().catch(() => {}) }
  checks.push('switch resets transform and pointer state')
  await close()

  const annotationItems = [
    { id: 'note-a', src: normal, name: 'Annotated first', width: 640, height: 480 },
    { id: 'note-b', src: normalTwo, name: 'Annotated second', width: 640, height: 480 },
  ]
  const addNote = async (viewer, value, x = 0.36, y = 0.4) => {
    await viewer.getByRole('button', { name: 'Mark region', exact: true }).click()
    const imageBox = await viewer.locator('.niv-image').boundingBox()
    assert.ok(imageBox)
    await page.mouse.click(imageBox.x + imageBox.width * x, imageBox.y + imageBox.height * y)
    const field = viewer.locator('.niv-inline-note textarea')
    await field.waitFor()
    if (value !== undefined) await field.fill(value)
    return field
  }
  await open(annotationItems, 0, undefined, { annotations: true })
  await waitReady()
  const annotationViewer = page.locator('.niv-root')
  let noteField = await addNote(annotationViewer, 'Alpha')
  await noteField.press('Shift+Enter')
  await noteField.type('Beta')
  assert.equal(await noteField.inputValue(), 'Alpha\nBeta')
  await noteField.press('Enter')
  await noteField.waitFor({ state: 'hidden' })
  assert.equal(await annotationViewer.locator('.niv-annotation').count(), 1)
  await annotationViewer.locator('.niv-pin').first().click()
  noteField = annotationViewer.locator('.niv-inline-note textarea')
  await noteField.waitFor()
  const imeValue = await evaluatePage(function dispatchComposingEnter() {
    const field = document.querySelector('.niv-inline-note textarea')
    field.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
    }))
    return field.value
  })
  assert.equal(imeValue, 'Alpha\nBeta')
  await noteField.waitFor()
  await noteField.press('Escape')
  await noteField.waitFor({ state: 'hidden' })
  await annotationViewer.waitFor({ state: 'visible' })
  await annotationViewer.locator('.niv-pin').first().click()
  noteField = annotationViewer.locator('.niv-inline-note textarea')
  await noteField.waitFor()
  await noteField.press('Enter')
  await noteField.waitFor({ state: 'hidden' })
  checks.push('annotation create edit multiline enter escape and IME composing Enter')

  await evaluatePage(function installClipboard() {
    window.__clipboardWrites = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { window.__clipboardWrites.push(value) } },
    })
  })
  const copyNotes = annotationViewer.locator('.niv-copy-notes')
  await copyNotes.click()
  await page.waitForFunction(() => document.querySelector('.niv-copy-notes')?.textContent.includes('Copied'))
  const clipboardState = await page.evaluate(() => ({ writes: window.__clipboardWrites, label: document.querySelector('.niv-copy-notes')?.textContent }))
  assert.equal(clipboardState.writes.length, 1)
  assert.match(clipboardState.writes[0], /Region 1 \(\d+%,\s*\d+%\): Alpha\nBeta/u)
  assert.match(clipboardState.label, /Copied/u)
  await evaluatePage(function rejectClipboard() {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('synthetic clipboard failure') } },
    })
  })
  await copyNotes.click()
  await page.waitForFunction(() => document.querySelector('.niv-copy-notes')?.textContent.includes('Copy failed'))
  checks.push('copy notes success and failure')

  await annotationViewer.getByRole('button', { name: 'Next image', exact: true }).click()
  await waitImageAlt('Annotated second')
  await waitReady()
  assert.equal(await annotationViewer.locator('.niv-annotation').count(), 0)
  await page.setViewportSize({ width: 580, height: 800 })
  await page.waitForFunction(() => window.innerWidth === 580)
  let noteB = await addNote(annotationViewer, 'Note B', 0.95, 0.05)
  const cornerNoteBox = await noteB.boundingBox()
  assert.ok(cornerNoteBox && cornerNoteBox.x >= 0 && cornerNoteBox.y >= 0 && cornerNoteBox.x + cornerNoteBox.width <= 580 && cornerNoteBox.y + cornerNoteBox.height <= 800, JSON.stringify(cornerNoteBox))
  await noteB.press('Enter')
  await noteB.waitFor({ state: 'hidden' })
  assert.equal(await annotationViewer.locator('.niv-annotation').count(), 1)
  checks.push('narrow corner note editor stays within viewport')
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForFunction(() => window.innerWidth === 1200)
  await annotationViewer.getByRole('button', { name: 'Previous image', exact: true }).click()
  await waitImageAlt('Annotated first')
  await waitReady()
  assert.equal(await annotationViewer.locator('.niv-annotation').count(), 1)
  await annotationViewer.locator('.niv-pin').first().click()
  assert.equal(await annotationViewer.locator('.niv-inline-note textarea').inputValue(), 'Alpha\nBeta')
  await annotationViewer.locator('.niv-inline-note textarea').press('Enter')
  await annotationViewer.getByRole('button', { name: 'Next image', exact: true }).click()
  await waitImageAlt('Annotated second')
  await waitReady()
  await annotationViewer.locator('.niv-pin').first().click()
  assert.equal(await annotationViewer.locator('.niv-inline-note textarea').inputValue(), 'Note B')
  await annotationViewer.locator('.niv-inline-note textarea').press('Escape')
  await annotationViewer.locator('.niv-pin').first().click()
  await annotationViewer.getByRole('button', { name: 'Remove region note', exact: true }).click()
  assert.equal(await annotationViewer.locator('.niv-annotation').count(), 0)
  await annotationViewer.getByRole('button', { name: 'Previous image', exact: true }).click()
  await waitImageAlt('Annotated first')
  await waitReady()
  await close()
  await open(annotationItems, 0, undefined, { annotations: true })
  await waitReady()
  assert.equal(await page.locator('.niv-annotation').count(), 1)
  await page.locator('.niv-pin').first().click()
  assert.equal(await page.locator('.niv-inline-note textarea').inputValue(), 'Alpha\nBeta')
  await page.locator('.niv-inline-note textarea').press('Escape')
  await page.locator('.niv-pin').first().click()
  await page.getByRole('button', { name: 'Remove region note', exact: true }).click()
  assert.equal(await page.locator('.niv-annotation').count(), 0)
  checks.push('independent notes across images delete and reopen persistence')
  await close()

  await evaluatePage(function initializeCallbackState() {
    window.__viewerState = {
      downloadPendingCalls: 0,
      downloadRetryCalls: 0,
      actionRetryCalls: 0,
      oldActionCalls: 0,
      downloadOperations: [],
    }
  })
  await registerPageCallbacks({
    oldActionPending: async () => {
      window.__viewerState.oldActionCalls += 1
      await new Promise(resolve => { window.__viewerState.resolveOldAction = resolve })
    },
    downloadPending: async ({ signal, onProgress }) => {
      window.__viewerState.downloadPendingCalls += 1
      const operation = { signal, onProgress }
      await new Promise((resolve, reject) => {
        Object.assign(operation, { resolve, reject })
        window.__viewerState.resolveDownload = resolve
        window.__viewerState.downloadOperations.push(operation)
      })
    },
    downloadFailRetry: async () => {
      window.__viewerState.downloadRetryCalls += 1
      if (window.__viewerState.downloadRetryCalls === 1) throw new Error('synthetic download failure')
    },
    actionFailRetry: async () => {
      window.__viewerState.actionRetryCalls += 1
      if (window.__viewerState.actionRetryCalls === 1) throw new Error('synthetic action failure')
    },
  })
  const oldRequestItems = [
    { id: 'old-other', src: normal, name: 'Old other' },
    { id: 'old-pending', src: normalTwo, name: 'Old pending action', actions: [{ id: 'old-action', label: 'Send old', pendingLabel: 'Sending old', errorLabel: 'Retry old', closeOnSuccess: true, callback: 'oldActionPending' }] },
  ]
  await open(oldRequestItems, 1)
  await waitReady()
  const oldActionButton = page.getByRole('button', { name: 'Send old', exact: true })
  await oldActionButton.click()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('.niv-button')].find(value => value.textContent.includes('Sending old'))
    return button?.disabled === true
  })
  assert.equal(await page.evaluate(() => window.__viewerState.oldActionCalls), 1)
  await page.evaluate(({ src }) => window.__viewerService.open({ items: [{ id: 'replacement', src, name: 'Replacement single image' }], index: 0, source: 'browser-test', annotations: false }), { src: normal })
  await waitImageAlt('Replacement single image')
  await waitReady()
  assert.equal(await page.locator('.niv-counter').count(), 0)
  await page.evaluate(() => window.__viewerState.resolveOldAction?.())
  await page.waitForFunction(() => document.querySelector('.niv-image')?.alt === 'Replacement single image' && document.querySelector('.niv-root') !== null)
  assert.deepEqual(pageErrors, [])
  checks.push('replace gallery index with single request and stale pending close guard')
  await close()

  await open([{ id: 'custom-pending', src: normal, name: 'Custom pending controls', download: { pendingLabel: 'Preparing custom', errorLabel: 'Retry custom download', callback: 'downloadPending' }, actions: [{ id: 'pending-action', label: 'Process custom', pendingLabel: 'Processing custom', errorLabel: 'Retry custom action', callback: 'oldActionPending' }] }])
  await waitReady()
  const pendingDownload = page.locator('.niv-download')
  const firstDownloadOperation = await page.evaluate(() => window.__viewerState.downloadOperations.length)
  await pendingDownload.click()
  await page.waitForFunction(index => window.__viewerState.downloadOperations.length === index + 1, firstDownloadOperation)
  await page.waitForFunction(() => {
    const button = document.querySelector('.niv-download')
    return button?.disabled === false && button.getAttribute('aria-label') === 'Cancel download'
      && button.textContent.includes('Preparing custom') && button.textContent.includes('Cancel')
  })
  await page.evaluate(index => window.__viewerState.downloadOperations[index].onProgress({ loaded: 50, total: 100 }), firstDownloadOperation)
  await page.waitForFunction(() => document.querySelector('.niv-download')?.textContent.includes('50%'))
  await pendingDownload.click()
  await page.waitForFunction(() => document.querySelector('.niv-download')?.getAttribute('aria-label') === 'Download' && document.querySelector('.niv-download')?.textContent.includes('Download'))
  await page.waitForFunction(index => window.__viewerState.downloadOperations[index].signal.aborted === true, firstDownloadOperation)

  const retryDownloadOperation = await page.evaluate(() => window.__viewerState.downloadOperations.length)
  await pendingDownload.click()
  await page.waitForFunction(index => window.__viewerState.downloadOperations.length === index + 1, retryDownloadOperation)
  await page.waitForFunction(() => document.querySelector('.niv-download')?.getAttribute('aria-label') === 'Cancel download')
  await page.evaluate(({ oldIndex, nextIndex }) => {
    const oldOperation = window.__viewerState.downloadOperations[oldIndex]
    oldOperation.onProgress({ loaded: 99, total: 100 })
    oldOperation.reject(new Error('late old download failure'))
    window.__viewerState.downloadOperations[nextIndex].onProgress({ loaded: 50, total: 100 })
  }, { oldIndex: firstDownloadOperation, nextIndex: retryDownloadOperation })
  await page.waitForFunction(() => {
    const button = document.querySelector('.niv-download')
    const text = button?.textContent ?? ''
    return button?.getAttribute('aria-label') === 'Cancel download' && text.includes('50%') && !text.includes('99%')
  })
  await page.evaluate(index => window.__viewerState.downloadOperations[index].resolve(), retryDownloadOperation)
  await page.waitForFunction(() => document.querySelector('.niv-download')?.disabled === false && document.querySelector('.niv-download')?.textContent.includes('Download'))
  const pendingAction = page.getByRole('button', { name: 'Process custom', exact: true })
  await pendingAction.click()
  await page.waitForFunction(() => [...document.querySelectorAll('.niv-button')].some(button => button.disabled && button.textContent.includes('Processing custom')))
  await page.evaluate(() => window.__viewerState.resolveOldAction?.())
  await page.waitForFunction(() => [...document.querySelectorAll('.niv-button')].some(button => !button.disabled && button.textContent.includes('Process custom')))
  checks.push('custom download progress cancel retry ignores stale callbacks')
  checks.push('custom action pending remains disabled')
  await close()

  const cancellationItems = [
    { id: 'cancel-first', src: normal, name: 'Cancel first', download: { callback: 'downloadPending' } },
    { id: 'cancel-second', src: normalTwo, name: 'Cancel second', download: { callback: 'downloadPending' } },
  ]
  await open(cancellationItems)
  await waitReady()
  const switchDownloadOperation = await page.evaluate(() => window.__viewerState.downloadOperations.length)
  await page.locator('.niv-download').click()
  await page.waitForFunction(index => window.__viewerState.downloadOperations.length === index + 1, switchDownloadOperation)
  await page.getByRole('button', { name: 'Next image', exact: true }).click()
  await waitImageAlt('Cancel second')
  await waitReady()
  await page.waitForFunction(index => window.__viewerState.downloadOperations[index].signal.aborted === true, switchDownloadOperation)
  const closeDownloadOperation = await page.evaluate(() => window.__viewerState.downloadOperations.length)
  await page.locator('.niv-download').click()
  await page.waitForFunction(index => window.__viewerState.downloadOperations.length === index + 1, closeDownloadOperation)
  await close()
  await page.waitForFunction(index => window.__viewerState.downloadOperations[index].signal.aborted === true, closeDownloadOperation)
  checks.push('download aborts on image switch and viewer close')

  await open([{ id: 'invalid-progress', src: normal, name: 'Invalid progress', download: { callback: 'downloadPending' } }])
  await waitReady()
  const invalidDownloadOperation = await page.evaluate(() => window.__viewerState.downloadOperations.length)
  await page.locator('.niv-download').click()
  await page.waitForFunction(index => window.__viewerState.downloadOperations.length === index + 1, invalidDownloadOperation)
  await page.evaluate(index => {
    const operation = window.__viewerState.downloadOperations[index]
    operation.onProgress({ loaded: 1, total: 0 })
    operation.onProgress({ loaded: 1, total: Number.NaN })
    operation.onProgress({ loaded: 1 })
  }, invalidDownloadOperation)
  await page.waitForFunction(() => {
    const text = document.querySelector('.niv-download')?.textContent ?? ''
    return /Preparing…|Preparing custom/u.test(text) && !/NaN|Infinity/u.test(text)
  })
  await page.locator('.niv-download').click()
  await page.waitForFunction(() => document.querySelector('.niv-download')?.getAttribute('aria-label') === 'Download')
  checks.push('invalid and unknown download totals stay indeterminate')
  await close()

  await open([{ id: 'download-retry', src: normal, name: 'Download retry', download: { errorLabel: 'Retry custom download', callback: 'downloadFailRetry' } }])
  await waitReady()
  await page.locator('.niv-download').click()
  await page.waitForFunction(() => document.querySelector('.niv-download')?.textContent.includes('Retry custom download') && !document.querySelector('.niv-download')?.disabled)
  assert.equal(await page.evaluate(() => window.__viewerState.downloadRetryCalls), 1)
  await page.locator('.niv-download').click()
  await page.waitForFunction(() => document.querySelector('.niv-download')?.textContent.includes('Download') && !document.querySelector('.niv-download')?.disabled)
  assert.equal(await page.evaluate(() => window.__viewerState.downloadRetryCalls), 2)
  checks.push('custom download failure retry')
  await close()
  await open([{ id: 'action-retry', src: normalTwo, name: 'Action retry', actions: [{ id: 'action-retry', label: 'Process retry', pendingLabel: 'Processing retry', errorLabel: 'Retry custom action', callback: 'actionFailRetry' }] }])
  await waitReady()
  await page.getByRole('button', { name: 'Process retry', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.niv-button')].some(button => button.textContent.includes('Retry custom action') && !button.disabled))
  assert.equal(await page.evaluate(() => window.__viewerState.actionRetryCalls), 1)
  await page.getByRole('button', { name: 'Retry custom action', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.niv-button')].some(button => button.textContent.includes('Process retry') && !button.disabled))
  assert.equal(await page.evaluate(() => window.__viewerState.actionRetryCalls), 2)
  checks.push('custom action failure retry')
  await close()

  await open([{ id: 'plain-data', src: normal, name: 'plain-image.svg' }])
  await waitReady()
  const dataBeforeUrl = page.url()
  const dataDownloadWait = page.waitForEvent('download')
  await page.locator('.niv-download').click()
  const dataDownload = await dataDownloadWait
  assert.equal(await dataDownload.failure(), null)
  assert.equal(dataDownload.suggestedFilename(), 'plain-image.svg')
  const dataDownloadPath = await dataDownload.path()
  assert.ok(dataDownloadPath)
  assert.equal((await readFile(dataDownloadPath)).toString('utf8'), plainBody)
  assert.equal(page.url(), dataBeforeUrl)
  checks.push('plain data image download filename bytes and page state')
  await page.waitForFunction(() => {
    const button = document.querySelector('.niv-download')
    return button instanceof HTMLButtonElement && !button.disabled && document.activeElement === button
  })
  await page.keyboard.press('Escape')
  await page.locator('.niv-root').waitFor({ state: 'hidden' })
  checks.push('data download restores focus and Escape closes viewer')

  const httpRequests = []
  let deniedCorsFetches = 0
  httpServer = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    const isImage = request.headers['sec-fetch-dest'] === 'image'
    const isCorsFetch = request.headers['sec-fetch-mode'] === 'cors' && !isImage
    if (path === '/denied.svg' && isCorsFetch) deniedCorsFetches += 1
    httpRequests.push({ path, mode: request.headers['sec-fetch-mode'], destination: request.headers['sec-fetch-dest'], isImage, isCorsFetch, deniedCorsFetches })
    if (path !== '/allowed.svg' && path !== '/denied.svg') {
      response.writeHead(404)
      response.end()
      return
    }
    const allowCors = path === '/allowed.svg' || (path === '/denied.svg' && isCorsFetch && deniedCorsFetches > 1)
    response.setHeader('Content-Type', 'image/svg+xml')
    response.setHeader('Cache-Control', 'no-store')
    if (allowCors) response.setHeader('Access-Control-Allow-Origin', '*')
    response.end(plainBody)
  })
  await new Promise((resolveServer, rejectServer) => {
    httpServer.once('error', rejectServer)
    httpServer.listen(0, '127.0.0.1', resolveServer)
  })
  const httpAddress = httpServer.address()
  assert.ok(httpAddress && typeof httpAddress === 'object')
  const allowedDownloadUrl = `http://127.0.0.1:${httpAddress.port}/allowed.svg`
  const deniedDownloadUrl = `http://127.0.0.1:${httpAddress.port}/denied.svg`
  await open([{ id: 'plain-http-allowed', src: allowedDownloadUrl, name: 'cross-origin.svg' }])
  await waitReady()
  const allowedBeforeUrl = page.url()
  const allowedDownloadWait = page.waitForEvent('download')
  await page.locator('.niv-download').click()
  const allowedDownload = await allowedDownloadWait
  assert.equal(await allowedDownload.failure(), null)
  assert.equal(allowedDownload.suggestedFilename(), 'cross-origin.svg')
  const allowedDownloadPath = await allowedDownload.path()
  assert.ok(allowedDownloadPath)
  assert.equal((await readFile(allowedDownloadPath)).toString('utf8'), plainBody)
  assert.equal(page.url(), allowedBeforeUrl)
  assert.equal(await page.locator('.niv-root').count(), 1)
  checks.push('cross-origin HTTP download with CORS keeps viewer and bytes')
  await close()

  await open([{ id: 'plain-http-denied', src: deniedDownloadUrl, name: 'cross-origin-retry.svg' }])
  await waitReady()
  const deniedBeforeUrl = page.url()
  const deniedDownload = page.locator('.niv-download')
  await deniedDownload.click()
  try {
    await page.waitForFunction(() => {
      const button = document.querySelector('.niv-download')
      return button !== null && !button.disabled && /Could not prepare|Retry/u.test(button.textContent ?? '')
    })
  } catch (error) {
    const state = await page.evaluate(() => ({ url: location.href, viewer: document.querySelector('.niv-root') !== null, download: document.querySelector('.niv-download')?.textContent, disabled: document.querySelector('.niv-download')?.disabled }))
    error.message = `${error.message}; denied state ${JSON.stringify({ state, httpRequests })}`
    throw error
  }
  assert.equal(deniedCorsFetches, 1)
  assert.deepEqual(httpRequests.filter(request => request.path === '/denied.svg').map(request => ({ mode: request.mode, isImage: request.isImage, isCorsFetch: request.isCorsFetch })), [
    { mode: 'no-cors', isImage: true, isCorsFetch: false },
    { mode: 'cors', isImage: false, isCorsFetch: true },
  ])
  assert.equal(page.url(), deniedBeforeUrl)
  assert.equal(await page.locator('.niv-root').count(), 1)
  const deniedRetryWait = page.waitForEvent('download')
  await deniedDownload.click()
  const deniedRetry = await deniedRetryWait
  assert.equal(await deniedRetry.failure(), null)
  assert.equal(deniedRetry.suggestedFilename(), 'cross-origin-retry.svg')
  const deniedRetryPath = await deniedRetry.path()
  assert.ok(deniedRetryPath)
  assert.equal((await readFile(deniedRetryPath)).toString('utf8'), plainBody)
  assert.equal(page.url(), deniedBeforeUrl)
  assert.equal(await page.locator('.niv-root').count(), 1)
  assert.equal(deniedCorsFetches, 2)
  checks.push('cross-origin HTTP CORS failure is retryable without navigation')
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
  if (httpServer?.listening) await new Promise(resolveServer => httpServer.close(resolveServer))
}
