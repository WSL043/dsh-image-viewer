export async function renderAnnotationImage(blob, annotations) {
  const image = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(image, 0, 0)
    const radius = Math.max(12, Math.min(image.width, image.height) / 60)
    annotations.forEach((annotation, index) => {
      const x = Math.max(radius, Math.min(image.width - radius, annotation.x * image.width))
      const y = Math.max(radius, Math.min(image.height - radius, annotation.y * image.height))
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = '#26272a'
      context.fill()
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2, radius / 7)
      context.stroke()
      context.fillStyle = '#ffffff'
      context.font = `600 ${radius}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(index + 1), x, y)
    })
    return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/png'))
  } finally { image.close() }
}

// Capture the destination when the viewer opens, then validate it again after
// asynchronous image preparation. Never send or redirect another session.
export function createAnnotationCommit(ctx, { readBlob, render = renderAnnotationImage, formatNotes }) {
  let sessions, conversation, sessionId
  try {
    sessions = ctx.get('sessions')
    conversation = ctx.get('conversation')
    sessionId = sessions.list.getSnapshot().current
  } catch { /* The viewer also works without a conversation host. */ }
  return async entries => {
    if (!sessionId || !conversation?.input?.for || sessions.list.getSnapshot().current !== sessionId) throw new Error('Composer unavailable or session changed')
    const prepared = await Promise.all(entries.map(async ({ item, annotations }) => {
      const image = await render(await readBlob(item.src), annotations)
      const name = `${String(item.name || 'image').replace(/\.[^.]+$/, '')}-annotated.png`
      return { file: new File([image], name, { type: 'image/png' }), text: `${name}\n${formatNotes(annotations)}` }
    }))
    if (sessions.list.getSnapshot().current !== sessionId) throw new Error('Session changed')
    const input = conversation.input.for(sessions.scope(sessionId))
    const state = input.state.getSnapshot()
    if (state.phase !== 'plain' || state.occurrences?.length) throw new Error('Composer busy or contains references')
    const modern = typeof conversation.createDrafts === 'function'
    const add = modern ? input.addAttachments : input.addImages
    const release = modern ? conversation.releaseDraftAttachments : conversation.releaseDraftImages
    if (typeof add !== 'function' || typeof release !== 'function') throw new Error('Composer unavailable')
    const created = modern ? conversation.createDrafts(sessionId, prepared.map(item => item.file)) : conversation.createDraftImages(prepared.map(item => item.file))
    try {
      if (!add.call(input, created.map(item => item.id))) throw new Error('Composer busy')
    } catch (error) { release.call(conversation, created); throw error }
    input.setDraft([state.draft, ...prepared.map(item => item.text)].filter(Boolean).join('\n\n'))
  }
}
