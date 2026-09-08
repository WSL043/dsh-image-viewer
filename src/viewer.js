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
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `image-${position + 1}`,
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
  }
}

export class NativeImageViewerService {
  #listeners = new Set()
  #revision = 0
  #snapshot
  #annotationsByImage = new Map()

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
    if (typeof imageId !== 'string' || imageId === '' || !Array.isArray(annotations)) return
    if (annotations.length === 0) this.#annotationsByImage.delete(imageId)
    else this.#annotationsByImage.set(imageId, annotations.map(annotation => ({ ...annotation })))
  }

  open(request) {
    const normalized = normalizeViewerRequest(request)
    if (normalized === undefined) return false
    this.#revision += 1
    this.#snapshot = { ...normalized, revision: this.#revision }
    this.#emit()
    return true
  }

  close() {
    if (this.#snapshot === undefined) return
    const opener = this.#snapshot.opener
    this.#snapshot = undefined
    this.#emit()
    if (typeof window === 'undefined') opener?.focus()
    else window.requestAnimationFrame(() => { opener?.focus() })
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
  if (button.matches('[data-variant="single"],[data-variant="tile"]')) return { button, image, group: button.parentElement }
  const rail = button.closest('[role="group"]')
  if (rail !== null && button.hasAttribute('title')) return { button, image, group: rail }
  return undefined
}

export function imageItemsForButton(match) {
  const buttons = match.group?.querySelectorAll('button[data-variant="single"],button[data-variant="tile"],button[title]')
    ?? []
  const candidates = [...buttons].flatMap((button, index) => {
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
