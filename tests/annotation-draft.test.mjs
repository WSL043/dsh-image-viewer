import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeImageViewerService } from '../src/viewer.js'
import { createAnnotationCommit } from '../src/annotation-draft.js'

const annotations = [{ id: 'note', x: .3, y: .4, note: 'change this' }]
const item = { id: 'image', src: 'blob:example', name: 'sample.png' }

test('session switch during image preparation leaves both drafts and attachments untouched', async () => {
  let current = 'original', finish
  const prepared = new Promise(resolve => { finish = resolve })
  const sessions = { list: { getSnapshot: () => ({ current }) }, scope: () => assert.fail('must not obtain another session input') }
  const conversation = { input: { for: () => assert.fail('must not mutate a draft') } }
  const commit = createAnnotationCommit({ get: key => key === 'sessions' ? sessions : conversation }, {
    readBlob: () => prepared, render: async blob => blob, formatNotes: () => 'notes',
  })
  const saving = commit([{ item, annotations }])
  current = 'other'
  finish(new Blob(['image']))
  await assert.rejects(saving, /Session changed/)
})

test('closing changed annotations commits once; unchanged reopening and unmarked images do not', async () => {
  const service = new NativeImageViewerService()
  let calls = 0
  const request = { items: [item], commitAnnotations: async entries => { calls++; assert.equal(entries[0].annotations[0].note, 'change this') } }
  service.open(request)
  service.setAnnotations(item.id, annotations)
  await Promise.all([service.close(), service.close()])
  assert.equal(calls, 1)
  assert.equal(service.getSnapshot(), undefined)
  service.open(request)
  await service.close()
  assert.equal(calls, 1)
})

test('failed intake retains notes and supports retry or explicit close without intake', async () => {
  const service = new NativeImageViewerService()
  service.open({ items: [item], commitAnnotations: async () => { throw Error('busy') } })
  service.setAnnotations(item.id, annotations)
  await service.close()
  assert.equal(service.getSnapshot().commitError, true)
  assert.equal(service.getAnnotationsSnapshot().image[0].note, 'change this')
  await service.close({ discard: true })
  assert.equal(service.getSnapshot(), undefined)
})

for (const modern of [true, false]) test(`annotation intake preserves current draft using ${modern ? 'attachment' : 'legacy image'} API`, async () => {
  let draft = 'Existing text', current = 'session', ids = [], released = 0
  const input = { state: { getSnapshot: () => ({ phase: 'plain', draft }) }, setDraft: value => { draft = value } }
  input[modern ? 'addAttachments' : 'addImages'] = values => { ids = values; return true }
  const conversation = { input: { for: () => input } }
  conversation[modern ? 'createDrafts' : 'createDraftImages'] = (...args) => {
    const files = modern ? args[1] : args[0]
    assert.equal(files[0].type, 'image/png')
    return [{ id: 'attachment' }]
  }
  conversation[modern ? 'releaseDraftAttachments' : 'releaseDraftImages'] = () => { released++ }
  const sessions = { list: { getSnapshot: () => ({ current }) }, scope: id => id }
  const commit = createAnnotationCommit({ get: key => key === 'sessions' ? sessions : conversation }, {
    readBlob: async () => new Blob(['source']), render: async () => new Blob(['rendered']), formatNotes: () => 'Region 1: change this',
  })
  await commit([{ item, annotations }])
  assert.deepEqual(ids, ['attachment'])
  assert.equal(draft, 'Existing text\n\nsample-annotated.png\nRegion 1: change this')
  input[modern ? 'addAttachments' : 'addImages'] = () => false
  await assert.rejects(commit([{ item, annotations }]), /busy/)
  assert.equal(released, 1)
  current = 'other'
  await assert.rejects(commit([{ item, annotations }]), /session changed/)
})
