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
