const boundedNumber = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
const downloadOf = value => typeof value?.onInvoke === 'function' ? {
  pendingLabel: typeof value.pendingLabel === 'string' && value.pendingLabel !== '' ? value.pendingLabel : undefined,
  errorLabel: typeof value.errorLabel === 'string' && value.errorLabel !== '' ? value.errorLabel : undefined,
  onInvoke: value.onInvoke,
} : undefined
const actionsOf = value => Array.isArray(value) ? value.flatMap((action, position) => {
  if (typeof action?.onInvoke !== 'function' || typeof action?.label !== 'string' || action.label.trim() === '') return []
  return [{
    id: typeof action.id === 'string' && action.id !== '' ? action.id : `action-${position + 1}`,
    label: action.label,
    pendingLabel: typeof action.pendingLabel === 'string' && action.pendingLabel !== '' ? action.pendingLabel : action.label,
    errorLabel: typeof action.errorLabel === 'string' && action.errorLabel !== '' ? action.errorLabel : action.label,
    closeOnSuccess: action.closeOnSuccess === true,
    onInvoke: action.onInvoke,
  }]
}) : []

export function normalizeViewerRequest(request) {
  const rawItems = Array.isArray(request?.items) ? request.items : []
  const items = rawItems.flatMap((item, position) => {
    if (typeof item?.src !== 'string' || item.src === '') return []
    return [{
      id: typeof item.id === 'string' && item.id !== '' ? item.id : item.src,
      src: item.src,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : `Image ${position + 1}`,
      width: boundedNumber(item.width, undefined),
      height: boundedNumber(item.height, undefined),
      bytes: boundedNumber(item.bytes, undefined),
      download: downloadOf(item.download),
      actions: actionsOf(item.actions),
    }]
  })
  if (items.length === 0) return undefined
  const requestedIndex = Number.isInteger(request?.index) ? request.index : 0
  return {
    items,
    index: Math.max(0, Math.min(items.length - 1, requestedIndex)),
    opener: typeof HTMLElement !== 'undefined' && request?.opener instanceof HTMLElement ? request.opener : undefined,
    source: typeof request?.source === 'string' ? request.source : 'dsh',
    annotations: request?.annotations !== false,
    commitAnnotations: typeof request?.commitAnnotations === 'function' ? request.commitAnnotations : undefined,
  }
}

export class NativeImageViewerService {
  #listeners = new Set()
  #revision = 0
  #snapshot
  #annotationsByImage = new Map()
  #openingAnnotations = new Map()
  #closeOperation
  #disposed = false

  constructor() {
    this.subscribe = listener => {
      this.#listeners.add(listener)
      return () => { this.#listeners.delete(listener) }
    }
    this.getSnapshot = () => this.#snapshot
    this.getAnnotationsSnapshot = () => Object.fromEntries(
      [...this.#annotationsByImage].map(([id, annotations]) => [id, annotations.map(annotation => ({ ...annotation }))]),
    )
  }

  setAnnotations(imageId, annotations) {
    if (this.#disposed) return
    if (typeof imageId !== 'string' || imageId === '' || !Array.isArray(annotations)) return
    if (annotations.length === 0) this.#annotationsByImage.delete(imageId)
    else this.#annotationsByImage.set(imageId, annotations.map(annotation => ({ ...annotation })))
  }

  open(request) {
    if (this.#disposed || this.#closeOperation) return false
    const normalized = normalizeViewerRequest(request)
    if (normalized === undefined) return false
    this.#revision += 1
    this.#snapshot = { ...normalized, revision: this.#revision }
    this.#openingAnnotations = new Map(normalized.items.map(item => [item.id, JSON.stringify(this.#annotationsByImage.get(item.id) || [])]))
    this.#emit()
    return true
  }

  async close({ discard = false } = {}) {
    if (this.#snapshot === undefined) return
    if (discard) {
      const request = this.#snapshot
      this.#cancelCommit()
      this.#dismiss(request)
      return true
    }
    if (this.#closeOperation) return this.#closeOperation.promise
    const request = this.#snapshot
    const pending = request.items.map(item => ({ item, annotations: this.#annotationsByImage.get(item.id) || [] }))
      .filter(({ item, annotations }) => annotations.some(note => note.note.trim()) && JSON.stringify(annotations) !== this.#openingAnnotations.get(item.id))
    if (pending.length && request.commitAnnotations) {
      const operation = { controller: new AbortController() }
      this.#closeOperation = operation
      this.#snapshot = { ...request, committing: true, commitError: false }
      this.#emit()
      operation.promise = this.#commitAndClose(operation, request, pending)
      return operation.promise
    }
    this.#dismiss(request)
    return true
  }

  async #commitAndClose(operation, request, pending) {
    try { await request.commitAnnotations(pending, { signal: operation.controller.signal }) }
    catch {
      if (this.#closeOperation !== operation) return false
      this.#closeOperation = undefined
      this.#snapshot = { ...request, committing: false, commitError: true }
      this.#emit()
      return false
    }
    if (this.#closeOperation !== operation) return false
    this.#closeOperation = undefined
    this.#dismiss(request)
    return true
  }

  #cancelCommit() {
    const operation = this.#closeOperation
    this.#closeOperation = undefined
    operation?.controller.abort()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#cancelCommit()
    this.#snapshot = undefined
    this.#emit()
    this.#listeners.clear()
  }

  #dismiss(request) {
    if (this.#snapshot?.revision !== request.revision) return
    this.#snapshot = undefined
    this.#emit()
    const restoreFocus = () => {
      if (!this.#disposed && this.#snapshot === undefined && this.#revision === request.revision && request.opener?.isConnected !== false) request.opener?.focus()
    }
    if (typeof window === 'undefined') restoreFocus()
    else window.requestAnimationFrame(restoreFocus)
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }
}

export function nativeImageButton(target) {
  if (!(target instanceof Element)) return undefined
  const button = target.closest('button')
  if (!(button instanceof HTMLButtonElement)) return undefined
  const image = button.querySelector(':scope > img')
  if (!(image instanceof HTMLImageElement) || image.currentSrc === '') return undefined
  if (button.matches('[data-variant="single"],[data-variant="tile"]')) return { button, image, group: button.parentElement, kind: 'message' }
  const rail = button.closest('[role="group"]')
  if (rail !== null && button.hasAttribute('title')) return { button, image, group: rail, kind: 'composer' }
  return undefined
}

export function imageItemsForButton(match) {
  const selector = match.kind === 'message'
    ? ':scope > button[data-variant="single"],:scope > button[data-variant="tile"]'
    : 'button[title]'
  const buttons = match.group?.querySelectorAll(selector)
    ?? []
  const candidates = [...buttons].flatMap((button, index) => {
    if (match.kind === 'composer' && button.closest('[role="group"]') !== match.group) return []
    const image = button.querySelector(':scope > img')
    if (!(image instanceof HTMLImageElement) || image.currentSrc === '') return []
    return [{
      id: image.currentSrc,
      src: image.currentSrc,
      name: image.alt || `Image ${index + 1}`,
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
      button,
    }]
  })
  const items = candidates.length > 0 ? candidates : [{
    id: match.image.currentSrc,
    src: match.image.currentSrc,
    name: match.image.alt || 'Image',
    width: match.image.naturalWidth || undefined,
    height: match.image.naturalHeight || undefined,
    button: match.button,
  }]
  const index = Math.max(0, items.findIndex(item => item.button === match.button))
  return { items: items.map(({ button: _button, ...item }) => item), index }
}
