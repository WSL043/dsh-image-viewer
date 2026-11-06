import assert from 'node:assert/strict'
import test from 'node:test'
import { registerImageAnnotations } from '../src/official-image-actions.js'
test('official menu action captures its image and unregisters on unload', () => {
  let contribution, opened, commits = 0, removed = false
  const dispose = registerImageAnnotations({ contextMenus: { register(value) { contribution = value; return () => { removed = true } } } }, { open: value => { opened = value } }, { label: () => 'Annotate image', createCommit: () => { commits++; return () => {} } })
  assert.equal(contribution.target, 'image')
  assert.deepEqual(contribution.resolve({ url: '' }), [])
  const first = contribution.resolve({ url: 'blob:first', name: 'first.png' })
  contribution.resolve({ url: 'blob:second', name: 'second.png' })
  assert.equal(opened, undefined)
  first[0].run()
  assert.equal(opened.items[0].src, 'blob:first')
  assert.equal(opened.items[0].name, 'first.png')
  assert.equal(commits, 1)
  dispose(); assert.equal(removed, true)
})
