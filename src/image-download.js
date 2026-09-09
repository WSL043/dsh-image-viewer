export function downloadPercent(value) {
  const { loaded, total } = value ?? {}
  if (!Number.isFinite(loaded) || loaded < 0 || !Number.isFinite(total) || total <= 0) return undefined
  return Math.min(100, Math.floor(loaded / total * 100))
}

export async function readImageBlob(src, { signal, onProgress }) {
  const response = await fetch(src, { signal })
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`)
  if (!response.body) return response.blob()
  // Compressed transfer lengths do not describe the decoded stream's size.
  const length = response.headers.get('content-encoding') ? undefined : Number(response.headers.get('content-length'))
  const total = Number.isFinite(length) && length > 0 ? length : undefined
  const reader = response.body.getReader()
  const chunks = []
  let loaded = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      onProgress({ loaded, total })
    }
    signal.throwIfAborted()
    return new Blob(chunks, { type: response.headers.get('content-type') || '' })
  } finally {
    reader.releaseLock()
  }
}
