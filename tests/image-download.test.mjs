import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadPercent, readImageBlob } from '../src/image-download.js'

test('download percentage stays bounded and unknown lengths stay indeterminate', () => {
  assert.equal(downloadPercent({ loaded: 5, total: 10 }), 50)
  assert.equal(downloadPercent({ loaded: 20, total: 10 }), 100)
  for (const value of [null, {}, { loaded: 1, total: 0 }, { loaded: -1, total: 4 }, { loaded: Infinity, total: 4 }, { loaded: 1, total: NaN }]) {
    assert.equal(downloadPercent(value), undefined)
  }
})

test('streamed download preserves bytes and MIME type and reports progress', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array([1, 2]))
      stream.enqueue(new Uint8Array([3, 4]))
      stream.close()
    },
  }), { headers: { 'content-type': 'image/png', 'content-length': '4' } }))
  const progress = []
  const blob = await readImageBlob('fixture', { signal: new AbortController().signal, onProgress: value => progress.push(value) })
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4])
  assert.equal(blob.type, 'image/png')
  assert.deepEqual(progress, [{ loaded: 2, total: 4 }, { loaded: 4, total: 4 }])
})

test('compressed downloads do not turn the transfer length into a false percentage', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('decoded', { headers: { 'content-encoding': 'gzip', 'content-length': '3' } }))
  const progress = []
  await readImageBlob('fixture', { signal: new AbortController().signal, onProgress: value => progress.push(value) })
  assert.deepEqual(progress, [{ loaded: 7, total: undefined }])
})

test('cancellation prevents a completed response from producing a saved blob', async t => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (_src, options) => {
    assert.equal(options.signal, controller.signal)
    return new Response('image')
  })
  await assert.rejects(readImageBlob('fixture', {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  }), { name: 'AbortError' })
})
