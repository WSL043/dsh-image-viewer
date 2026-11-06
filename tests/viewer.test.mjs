import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeImageViewerService, normalizeViewerRequest } from '../src/viewer.js'

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

test('discard preserves a gallery opened synchronously by the commit abort listener', async () => {
  const service = new NativeImageViewerService()
  let finish, openedDuringAbort = false
  service.open({
    items: [{ id: 'old', src: 'blob:old' }],
    commitAnnotations: (_entries, { signal }) => new Promise(resolve => {
      finish = resolve
      signal.addEventListener('abort', () => {
        openedDuringAbort = service.open({ items: [{ id: 'new', src: 'blob:new' }] })
      }, { once: true })
    }),
  })
  service.setAnnotations('old', [{ id: 'note', x: .3, y: .4, note: 'Keep this note' }])
  const closing = service.close()
  assert.equal(service.getSnapshot().committing, true)
  await service.close({ discard: true })
  assert.equal(openedDuringAbort, true)
  const reopened = service.getSnapshot()
  assert.equal(reopened.items[0].id, 'new')
  finish()
  await closing
  assert.equal(service.getSnapshot(), reopened)
  assert.equal(service.getAnnotationsSnapshot().old[0].note, 'Keep this note')
})

test('deferred focus restoration does not steal focus from a new gallery or plugin disposal', () => {
  const previousElement = globalThis.HTMLElement, previousWindow = globalThis.window
  class ElementStub {}
  const frames = []
  let focused = 0
  globalThis.HTMLElement = ElementStub
  globalThis.window = { requestAnimationFrame: callback => { frames.push(callback) } }
  const opener = Object.assign(new ElementStub(), { isConnected: true, focus: () => { focused++ } })
  try {
    const service = new NativeImageViewerService()
    service.open({ items: [{ src: 'blob:first' }], opener })
    void service.close()
    service.open({ items: [{ src: 'blob:second' }], opener })
    frames.shift()()
    assert.equal(focused, 0)
    void service.close()
    service.dispose()
    frames.shift()()
    assert.equal(focused, 0)
    const another = new NativeImageViewerService()
    another.open({ items: [{ src: 'blob:third' }], opener })
    void another.close()
    opener.isConnected = false
    frames.shift()()
    assert.equal(focused, 0)
  } finally {
    if (previousElement === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = previousElement
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
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
