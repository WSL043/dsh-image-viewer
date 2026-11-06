// Generated images and a local fake model: no user profile, credentials or network model calls.
import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareEvidenceDirectory } from './evidence-paths.mjs'

function png(color) {
  const crc = data => { let v = 0xffffffff; for (const b of data) { v ^= b; for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (0xedb88320 & -(v & 1)) } return (v ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc(body), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(640); header.writeUInt32BE(480, 4); header[8] = 8; header[9] = 2
  const row = Buffer.alloc(640 * 3 + 1); for (let x = 0; x < 640; x++) Buffer.from(color).copy(row, 1 + x * 3)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 480 }, () => row)))), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
async function applyFixture(ctx, images) {
  const provider = 'image-viewer-fixture'
  const adapter = {
    providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, maxBytes: image.bytes }),
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model) { return { model: await this.resolveModel(provider, model), stream: () => this.stream() } },
    async *stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Synthetic image acceptance response' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Synthetic image acceptance response' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  ctx.llm.registerAdapter([provider], adapter)
  const attachment = await ctx.attachments.saveImages(images.map((data, i) => ({ data: new Uint8Array(Buffer.from(data, 'base64')), mediaType: 'image/png', name: 'fixture-' + i + '.png' })))
  const sessionId = globalThis.crypto.randomUUID()
  const handle = await ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions: { provider, model: 'done' } })
  ctx.effect(() => () => handle.dispose(), 'dispose fixture-owned agent')
  ctx.sessionTitle.rename(handle.agent.session, 'Image viewer acceptance')
  handle.agent.followup({ id: globalThis.crypto.randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Generated image acceptance' }, ...attachment.map(attachment => ({ type: 'image', attachment }))] })
  await handle.agent.whenIdle()
  await ctx.sessionPersistence.flush()
  if (typeof await ctx.sessionPersistence.resolveCurrentLog(sessionId) !== 'string') throw Error('Fixture session was not persisted')
}

const root = await prepareEvidenceDirectory(process.argv[2])
await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-image-viewer-acceptance-fixture', version: '0.0.0', private: true, type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
await writeFile(join(root, 'cordis.patch.yml'), '- insert:\n    - id: image-viewer-acceptance-fixture\n      name: dsh-image-viewer-acceptance-fixture\n')
await writeFile(join(root, 'index.mjs'), "import { Buffer } from 'node:buffer'\nexport const inject = ['agents', 'llm', 'attachments', 'sessionTitle', 'sessionPersistence']\nexport async function apply(ctx) { await (" + applyFixture.toString() + ')(ctx, ' + JSON.stringify([png([35,119,170]), png([170,85,35])]) + ') }\n')
console.log('Generated isolated image fixture')
