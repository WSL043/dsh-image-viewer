import assert from 'node:assert/strict'
import test from 'node:test'
import { imageItemsForButton, NativeImageViewerService, normalizeViewerRequest } from '../src/viewer.js'

const withImageElementStub = callback => {
  const previousImageElement = globalThis.HTMLImageElement
  class ImageStub {}
  globalThis.HTMLImageElement = ImageStub
  try {
    return callback(ImageStub)
  } finally {
    if (previousImageElement === undefined) delete globalThis.HTMLImageElement
    else globalThis.HTMLImageElement = previousImageElement
  }
}

const imageStub = (ImageStub, src, alt) => Object.assign(new ImageStub(), {
  alt,
  currentSrc: src,
  naturalHeight: 80,
  naturalWidth: 120,
})

const buttonStub = (image, { title, variant } = {}) => ({
  image,
  title,
  variant,
  querySelector(selector) {
    assert.equal(selector, ':scope > img')
    return this.image ?? null
  },
})

const groupStub = buttons => ({
  querySelectorAll(selector) {
    assert.equal(selector, 'button[data-variant="single"],button[data-variant="tile"],button[title]')
    return buttons.filter(button => button.variant === 'single' || button.variant === 'tile' || button.title !== undefined)
  },
})

test('normalizes a bounded gallery request', () => {
  const value = normalizeViewerRequest({
    items: [
      { id: 'a', src: 'blob:a', name: 'A', width: 120, height: 80 },
      { src: '', name: 'ignored' },
      { src: 'blob:b' },
    ],
    index: 9,
  })
  assert.equal(value.items.length, 2)
  assert.equal(value.index, 1)
  assert.equal(value.items[1].name, 'Image 3')
})

test('refuses to open an empty request', () => {
  const service = new NativeImageViewerService()
  assert.equal(service.open({ items: [] }), false)
  assert.equal(service.getSnapshot(), undefined)
})

test('keeps only explicit same-page item actions', () => {
  const invoke = async () => {}
  const value = normalizeViewerRequest({ items: [{ src: 'blob:a', actions: [
    { id: 'original', label: 'Download original', pendingLabel: 'Preparing', errorLabel: 'Retry', closeOnSuccess: true, onInvoke: invoke },
    { label: '', onInvoke: invoke },
    { label: 'No callback' },
  ] }] })
  assert.deepEqual(value.items[0].actions, [{
    id: 'original', label: 'Download original', pendingLabel: 'Preparing', errorLabel: 'Retry', closeOnSuccess: true, onInvoke: invoke,
  }])
})

test('accepts one provider-owned default download without adding a second toolbar action', () => {
  const invoke = async () => {}
  const value = normalizeViewerRequest({ items: [{ src: 'blob:preview', download: {
    pendingLabel: 'Preparing original', errorLabel: 'Retry original', onInvoke: invoke,
  } }] })
  assert.deepEqual(value.items[0].download, {
    pendingLabel: 'Preparing original', errorLabel: 'Retry original', onInvoke: invoke,
  })
  assert.deepEqual(value.items[0].actions, [])
})

test('publishes open and close exactly once', () => {
  const service = new NativeImageViewerService()
  let changes = 0
  service.subscribe(() => { changes += 1 })
  assert.equal(service.open({ items: [{ src: 'blob:a' }] }), true)
  assert.equal(service.getSnapshot().revision, 1)
  service.close()
  assert.equal(service.getSnapshot(), undefined)
  assert.equal(changes, 2)
})

test('keeps region notes for the same image across overlay remounts', () => {
  const service = new NativeImageViewerService()
  service.setAnnotations('blob:a', [{ id: 'note-1', x: 0.4, y: 0.6, note: 'Keep this detail' }])
  const first = service.getAnnotationsSnapshot()
  assert.deepEqual(first['blob:a'], [{ id: 'note-1', x: 0.4, y: 0.6, note: 'Keep this detail' }])
  first['blob:a'][0].note = 'mutated copy'
  assert.equal(service.getAnnotationsSnapshot()['blob:a'][0].note, 'Keep this detail')
  service.setAnnotations('blob:a', [])
  assert.equal(service.getAnnotationsSnapshot()['blob:a'], undefined)
})

test('unnamed image identities do not reuse notes from another gallery', () => {
  const service = new NativeImageViewerService()
  service.open({ items: [{ src: 'blob:first' }] })
  const first = service.getSnapshot().items[0].id
  service.setAnnotations(first, [{ x: 0.5, y: 0.5, note: 'first image only' }])
  service.open({ items: [{ src: 'blob:second' }] })
  assert.equal(service.getAnnotationsSnapshot()[service.getSnapshot().items[0].id], undefined)
  service.open({ items: [{ src: 'blob:first' }] })
  assert.equal(service.getSnapshot().items[0].id, first)
})

test('collects both composer title images and uses the second image index', () => {
  withImageElementStub(ImageStub => {
    const firstImage = imageStub(ImageStub, 'blob:first', 'First')
    const secondImage = imageStub(ImageStub, 'blob:second', 'Second')
    const firstButton = buttonStub(firstImage, { title: 'Open first' })
    const nonImageButton = buttonStub(undefined, { title: 'Not an image' })
    const secondButton = buttonStub(secondImage, { title: 'Open second' })
    const result = imageItemsForButton({
      button: secondButton,
      image: secondImage,
      group: groupStub([firstButton, nonImageButton, secondButton]),
    })

    assert.deepEqual(result.items.map(item => item.src), ['blob:first', 'blob:second'])
    assert.equal(result.index, 1)
  })
})

test('keeps message single and tile images in DOM order', () => {
  withImageElementStub(ImageStub => {
    const singleImage = imageStub(ImageStub, 'blob:single', 'Single')
    const tileImage = imageStub(ImageStub, 'blob:tile', 'Tile')
    const singleButton = buttonStub(singleImage, { variant: 'single' })
    const tileButton = buttonStub(tileImage, { variant: 'tile' })
    const result = imageItemsForButton({
      button: tileButton,
      image: tileImage,
      group: groupStub([singleButton, tileButton]),
    })

    assert.deepEqual(result.items.map(item => item.src), ['blob:single', 'blob:tile'])
    assert.equal(result.index, 1)
  })
})
