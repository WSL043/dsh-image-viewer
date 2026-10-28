import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeImageViewerService } from '../src/viewer.js'
import { createAnnotationCommit, currentSessionId, renderAnnotationImage } from '../src/annotation-draft.js'

const annotations = [{ id: 'note', x: .3, y: .4, note: 'change this' }]
const item = { id: 'image', src: 'blob:example', name: 'sample.png' }

const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const draftHost = () => {
  const writes = []
  const input = {
    state: { getSnapshot: () => ({ phase: 'plain', draft: 'Existing text' }) },
    addAttachments: ids => { writes.push(['attachments', ids]); return true },
    setDraft: text => { writes.push(['text', text]) },
  }
  const conversation = {
    input: { for: () => input },
    createDrafts: (_session, files) => { writes.push(['files', files]); return files.map((_, index) => ({ id: `attachment-${index}` })) },
    releaseDraftAttachments: () => assert.fail('no attachment should need release'),
  }
  const sessions = { list: { getSnapshot: () => ({ current: 'session' }) }, scope: id => id }
  return { ctx: { get: key => key === 'sessions' ? sessions : conversation }, input, writes }
}

test('prepares gallery annotations sequentially and keeps attachment and note order', async () => {
  const { ctx, writes } = draftHost()
  const gates = [deferred(), deferred()], started = [deferred(), deferred()]
  const reads = []
  let renders = 0, active = 0, peak = 0
  const controller = new AbortController()
  const commit = createAnnotationCommit(ctx, {
    readBlob: async (src, { signal }) => {
      assert.equal(signal, controller.signal)
      reads.push(src)
      return new Blob([src])
    },
    render: async (blob, _notes, { signal }) => {
      assert.equal(signal, controller.signal)
      const index = renders++
      peak = Math.max(peak, ++active)
      started[index].resolve()
      await gates[index].promise
      active--
      return blob
    },
    formatNotes: notes => notes[0].note,
  })
  const saving = commit([
    { item, annotations },
    { item: { ...item, src: 'blob:second', name: 'second.png' }, annotations },
  ], { signal: controller.signal })
  await started[0].promise
  assert.deepEqual(reads, [item.src])
  assert.deepEqual(writes, [])
  gates[0].resolve()
  await started[1].promise
  assert.equal(peak, 1)
  gates[1].resolve()
  await saving
  assert.deepEqual(writes[0][1].map(file => file.name), ['sample-annotated.png', 'second-annotated.png'])
  assert.match(writes[2][1], /^Existing text\n\nsample-annotated.png\nchange this\n\nsecond-annotated.png\nchange this$/)
})

for (const stage of ['read', 'render']) test(`cancelling during ${stage} prevents later work and all draft writes even when the provider finishes late`, async () => {
  const { ctx, writes } = draftHost()
  const gate = deferred(), started = deferred(), controller = new AbortController()
  let reads = 0, renders = 0
  const commit = createAnnotationCommit(ctx, {
    readBlob: async () => {
      reads++
      if (stage === 'read') { started.resolve(); await gate.promise }
      return new Blob(['source'])
    },
    render: async blob => {
      renders++
      if (stage === 'render') { started.resolve(); await gate.promise }
      return blob
    },
    formatNotes: () => 'notes',
  })
  const saving = commit([{ item, annotations }, { item: { ...item, id: 'other' }, annotations }], { signal: controller.signal })
  await started.promise
  controller.abort()
  gate.resolve()
  await assert.rejects(saving, { name: 'AbortError' })
  assert.equal(reads, 1)
  assert.equal(renders, stage === 'render' ? 1 : 0)
  assert.deepEqual(writes, [])
})

test('last cancellation check precedes the synchronous attachment and draft boundary', async () => {
  const { ctx, input, writes } = draftHost()
  const controller = new AbortController()
  input.state.getSnapshot = () => { controller.abort(); return { phase: 'plain', draft: 'Existing text' } }
  const commit = createAnnotationCommit(ctx, {
    readBlob: async () => new Blob(['source']), render: async blob => blob, formatNotes: () => 'notes',
  })
  await assert.rejects(commit([{ item, annotations }], { signal: controller.signal }), { name: 'AbortError' })
  assert.deepEqual(writes, [])
})

for (const outcome of ['success', 'cancel', 'canvas-error']) test(`annotation ${outcome} releases the bitmap and canvas backing store`, async () => {
  const previousBitmap = globalThis.createImageBitmap, previousDocument = globalThis.document
  let closed = 0
  const controller = new AbortController()
  const canvas = {
    width: 0, height: 0,
    getContext: () => outcome === 'canvas-error' ? null : { drawImage() {} },
    toBlob: callback => { if (outcome === 'cancel') controller.abort(); callback(new Blob(['png'])) },
  }
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 768, close: () => { closed++ } })
  globalThis.document = { createElement: () => canvas }
  try {
    const rendering = renderAnnotationImage(new Blob(['source']), [], { signal: controller.signal })
    if (outcome === 'success') assert.equal((await rendering).size, 3)
    else await assert.rejects(rendering, outcome === 'cancel' ? { name: 'AbortError' } : /Canvas unavailable/)
    assert.equal(closed, 1)
    assert.equal(canvas.width, 0)
    assert.equal(canvas.height, 0)
  } finally {
    if (previousBitmap === undefined) delete globalThis.createImageBitmap
    else globalThis.createImageBitmap = previousBitmap
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

for (const outcome of ['resolve', 'reject']) test(`cancelled close cannot ${outcome} into a reopened gallery`, async () => {
  const service = new NativeImageViewerService(), gate = deferred()
  let signal, commits = 0
  service.open({ items: [item], commitAnnotations: (_entries, options) => { commits++; signal = options.signal; return gate.promise } })
  service.setAnnotations(item.id, annotations)
  const closing = service.close(), duplicate = service.close()
  assert.equal(commits, 1)
  assert.equal(service.getSnapshot().committing, true)
  await service.close({ discard: true })
  assert.equal(signal.aborted, true)
  assert.equal(service.getSnapshot(), undefined)
  assert.deepEqual(service.getAnnotationsSnapshot()[item.id], annotations)
  assert.equal(service.open({ items: [{ src: 'blob:new' }] }), true)
  const reopened = service.getSnapshot()
  if (outcome === 'resolve') gate.resolve()
  else gate.reject(Error('late failure'))
  await Promise.all([closing, duplicate])
  assert.equal(service.getSnapshot(), reopened)
})

test('disposal aborts pending annotation reads and prevents draft writes or reopening', async () => {
  const { ctx, writes } = draftHost(), gate = deferred(), started = deferred()
  const service = new NativeImageViewerService()
  let signal
  service.open({ items: [item], commitAnnotations: createAnnotationCommit(ctx, {
    readBlob: async (_src, options) => { signal = options.signal; started.resolve(); await gate.promise; return new Blob(['source']) },
    render: async () => assert.fail('disposed work must not render'), formatNotes: () => 'notes',
  }) })
  service.setAnnotations(item.id, annotations)
  const closing = service.close()
  await started.promise
  service.dispose()
  service.dispose()
  assert.equal(signal.aborted, true)
  assert.equal(service.getSnapshot(), undefined)
  assert.equal(service.open({ items: [item] }), false)
  gate.resolve()
  await closing
  assert.deepEqual(writes, [])
})

test('currentSessionId supports legacy current and alpha2 retained main view selection', () => {
  assert.equal(currentSessionId({ current: 'legacy', byId: {} }), 'legacy')
  assert.equal(currentSessionId({ byId: { alpha: { retainedBy: { mainView: 1 } } } }), 'alpha')
  assert.equal(currentSessionId({ byId: {
    alpha: { retainedBy: { mainView: 1 } },
    beta: { retainedBy: { mainView: 1 } },
  } }), undefined)
  assert.equal(currentSessionId({ byId: { alpha: { retainedBy: {} } } }), undefined)
})

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

test('alpha2 retained main view selection accepts annotations and rejects a changed or ambiguous selection before adding', async () => {
  let state = 'single', finish, created = 0, added = 0, draftWrites = 0
  const prepared = new Promise(resolve => { finish = resolve })
  const sessions = {
    list: { getSnapshot: () => state === 'single'
      ? { byId: { alpha: { retainedBy: { mainView: 1 } } } }
      : state === 'changed'
        ? { byId: { beta: { retainedBy: { mainView: 1 } } } }
        : { byId: {
            alpha: { retainedBy: { mainView: 1 } },
            beta: { retainedBy: { mainView: 1 } },
          } } },
    scope: id => { assert.equal(id, 'alpha'); return id },
  }
  const input = {
    state: { getSnapshot: () => ({ phase: 'plain', draft: '' }) },
    addAttachments: () => { added++; return true },
    setDraft: () => { draftWrites++ },
  }
  const conversation = {
    input: { for: () => input },
    createDrafts: () => { created++; return [{ id: 'attachment' }] },
    releaseDraftAttachments: () => assert.fail('selection failure must not create an attachment'),
  }
  const commit = createAnnotationCommit({ get: key => key === 'sessions' ? sessions : conversation }, {
    readBlob: () => prepared, render: async blob => blob, formatNotes: () => 'notes',
  })

  const saving = commit([{ item, annotations }])
  state = 'changed'
  finish(new Blob(['image']))
  await assert.rejects(saving, /Session changed/)
  assert.equal(created, 0)
  assert.equal(added, 0)
  assert.equal(draftWrites, 0)

  state = 'single'
  await commit([{ item, annotations }]).catch(error => assert.fail(error))
  assert.equal(created, 1)
  assert.equal(added, 1)
  assert.equal(draftWrites, 1)

  state = 'ambiguous'
  await assert.rejects(commit([{ item, annotations }]), /Composer unavailable or session changed/)
  assert.equal(created, 1)
  assert.equal(added, 1)
  assert.equal(draftWrites, 1)
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
