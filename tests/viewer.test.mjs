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
