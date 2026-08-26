import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import {
  Button, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
  IconCopyOutline16, IconDownloadOutline16, IconEditOutline16, IconFullscreenOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  imageItemsForButton, NativeImageViewerService, nativeImageButton,
} from './viewer.js'
import { CSS as VIEWER_CSS } from './styles.js'

export const name = 'dsh-native-image-viewer'
export const inject = ['locale', 'slots']

const LOCALES = {
  en: {
    dialog: 'Image viewer', close: 'Close', fit: 'Fit', actual: '100%', download: 'Download',
    annotate: 'Mark regions', regions: 'Region notes', regionHint: 'Click a point on the image, then add a note.',
    note: 'Region {value}', notePlaceholder: 'Describe what should change here…', removeNote: 'Remove region note',
    hideNotes: 'Hide notes', copyNotes: 'Copy notes', copied: 'Copied', previous: 'Previous image', next: 'Next image',
    zoomHint: 'Wheel to zoom · drag to pan · double-click for 100%', preparing: 'Preparing…', failed: 'Could not prepare this image.',
  },
  zh: {
    dialog: '图片查看器', close: '关闭', fit: '适应窗口', actual: '原始大小', download: '下载',
    annotate: '标记区域', regions: '区域备注', regionHint: '点击图片中的位置，然后填写备注。',
    note: '区域 {value}', notePlaceholder: '描述这里需要怎样调整…', removeNote: '删除区域备注',
    hideNotes: '收起备注', copyNotes: '复制备注', copied: '已复制', previous: '上一张图片', next: '下一张图片',
    zoomHint: '滚轮缩放 · 拖动查看 · 双击切换原始大小', preparing: '正在准备…', failed: '暂时无法准备这张图片。',
  },
}

const fill = (value, variables) => Object.entries(variables).reduce(
  (text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)),
  value,
)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const bytesLabel = bytes => bytes === undefined ? undefined : bytes < 1024 * 1024
  ? `${Math.max(0.1, bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`
  : `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`
const downloadName = name => {
  const cleaned = String(name || 'image.png').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/[. ]+$/u, '').trim()
  return cleaned === '' ? 'image.png' : cleaned
}
const noteText = (annotations, t) => annotations.map((annotation, index) => {
  const label = fill(t('note'), { value: index + 1 })
  return `${label} (${Math.round(annotation.x * 100)}%, ${Math.round(annotation.y * 100)}%): ${annotation.note.trim()}`
}).filter(line => !line.endsWith(': ')).join('\n')

function ViewerOverlay({ service, t }) {
  const request = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const [index, setIndex] = useState(0)
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [annotationsByImage, setAnnotationsByImage] = useState({})
  const [selected, setSelected] = useState()
  const [focusNote, setFocusNote] = useState()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const surfaceRef = useRef(null)
  const imageRef = useRef(null)
  const pointersRef = useRef(new Map())
  const gestureRef = useRef()
  const transformRef = useRef(transform)
  transformRef.current = transform

  useEffect(() => {
    if (request === undefined) return
    setIndex(request.index)
    setTransform({ zoom: 1, x: 0, y: 0 })
    setDragging(false)
    setAnnotating(false)
    setSidebar(false)
    setAnnotationsByImage({})
    setSelected(undefined)
    setPrompt('')
    setBusy(false)
    setEditorError(false)
    setCopied(false)
  }, [request?.revision])

  const item = request?.items[index]
  const annotations = item === undefined ? [] : annotationsByImage[item.id] ?? []
  const setAnnotations = useCallback((update) => {
    if (item === undefined) return
    setAnnotationsByImage(current => {
      const previous = current[item.id] ?? []
      const next = typeof update === 'function' ? update(previous) : update
      return { ...current, [item.id]: next }
    })
  }, [item?.id])

  const boundedPan = useCallback((zoom, x, y) => {
    const stage = stageRef.current
    const surface = surfaceRef.current
    if (stage === null || surface === null || zoom <= 1) return { x: 0, y: 0 }
    const limitX = Math.max(0, (surface.offsetWidth * zoom - stage.clientWidth) / 2) + 28
    const limitY = Math.max(0, (surface.offsetHeight * zoom - stage.clientHeight) / 2) + 28
    return { x: clamp(x, -limitX, limitX), y: clamp(y, -limitY, limitY) }
  }, [])

  const setZoomAt = useCallback((nextZoom, clientX, clientY) => {
    const stage = stageRef.current
    if (stage === null) return
    setTransform(current => {
      const next = clamp(nextZoom, 0.5, 8)
      const box = stage.getBoundingClientRect()
      const px = clientX - box.left - box.width / 2
      const py = clientY - box.top - box.height / 2
      const ratio = next / current.zoom
      const pan = boundedPan(next, px - (px - current.x) * ratio, py - (py - current.y) * ratio)
      return { zoom: next, ...pan }
    })
  }, [boundedPan])

  const fit = useCallback(() => { setTransform({ zoom: 1, x: 0, y: 0 }) }, [])
  const actual = useCallback(() => {
    const image = imageRef.current
    const surface = surfaceRef.current
    if (image === null || surface === null || image.naturalWidth === 0) return
    const zoom = clamp(image.naturalWidth / Math.max(1, surface.offsetWidth), 1, 8)
    setTransform({ zoom, x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (request === undefined) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        service.close()
        return
      }
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (!editing && event.key === 'ArrowLeft' && request.items.length > 1) {
        event.preventDefault(); setIndex(value => (value - 1 + request.items.length) % request.items.length)
      } else if (!editing && event.key === 'ArrowRight' && request.items.length > 1) {
        event.preventDefault(); setIndex(value => (value + 1) % request.items.length)
      } else if (!editing && (event.key === '+' || event.key === '=')) {
        event.preventDefault(); const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom * 1.2, box.left + box.width / 2, box.top + box.height / 2)
      } else if (!editing && event.key === '-') {
        event.preventDefault(); const box = stageRef.current?.getBoundingClientRect(); if (box) setZoomAt(transformRef.current.zoom / 1.2, box.left + box.width / 2, box.top + box.height / 2)
      } else if (!editing && event.key.toLowerCase() === 'f') {
        event.preventDefault(); fit()
      } else if (event.key === 'Tab') {
        const controls = [...rootRef.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [request, service, fit, setZoomAt])

  useEffect(() => {
    if (focusNote === undefined) return
    const field = rootRef.current?.querySelector(`[data-note-id="${CSS.escape(focusNote)}"] textarea`)
    field?.focus()
    setFocusNote(undefined)
  }, [focusNote, sidebar, annotations.length])

  useEffect(() => {
    setTransform({ zoom: 1, x: 0, y: 0 })
    setDragging(false)
    setAnnotating(false)
    setSidebar(false)
    setSelected(undefined)
    setEditorError(false)
  }, [item?.id])

  const onWheel = event => {
    event.preventDefault()
    setZoomAt(transform.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
  }
  const onPointerDown = event => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()]
      gestureRef.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), transform }
    } else if (!annotating && transform.zoom > 1) {
      gestureRef.current = { kind: 'pan', x: event.clientX, y: event.clientY, transform }
      setDragging(true)
    }
  }
  const onPointerMove = event => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (gesture?.kind === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      setZoomAt(gesture.transform.zoom * distance / Math.max(1, gesture.distance), (a.x + b.x) / 2, (a.y + b.y) / 2)
    } else if (gesture?.kind === 'pan') {
      const pan = boundedPan(gesture.transform.zoom, gesture.transform.x + event.clientX - gesture.x, gesture.transform.y + event.clientY - gesture.y)
      setTransform({ zoom: gesture.transform.zoom, ...pan })
    }
  }
  const endPointer = event => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 0) { gestureRef.current = undefined; setDragging(false) }
  }
  const addAnnotation = event => {
    if (!annotating || event.target.closest('.niv-pin')) return
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (bounds === undefined) return
    const annotation = {
      id: crypto.randomUUID(),
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      note: '',
    }
    setAnnotations(current => [...current, annotation])
    setSelected(annotation.id)
    setSidebar(true)
    setFocusNote(annotation.id)
  }
  const submit = async () => {
    if (busy || request?.editor?.onSubmit === undefined || item === undefined) return
    setBusy(true)
    setEditorError(false)
    try {
      await request.editor.onSubmit({ prompt, annotations, item, src: item.src })
      service.close()
    } catch {
      setEditorError(true)
    } finally {
      setBusy(false)
    }
  }
  const copyNotes = async () => {
    const text = noteText(annotations, t)
    if (text === '') return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1200)
  }

  if (request === undefined || item === undefined) return null
  const meta = [item.width && item.height ? `${item.width} × ${item.height}` : undefined, bytesLabel(item.bytes)].filter(Boolean).join(' · ')
  const showCounter = request.items.length > 1
  return <div ref={rootRef} className="niv-root" role="dialog" aria-modal="true" aria-label={t('dialog')} tabIndex={-1}>
    <header className="niv-topbar">
      <div className="niv-title"><strong>{item.name}</strong>{meta !== '' ? <small>{meta}</small> : null}</div>
      <div className="niv-actions">
        {request.annotations ? <button type="button" className="niv-button" data-active={annotating} aria-label={t('annotate')} aria-pressed={annotating} onClick={() => { setAnnotating(value => !value); if (annotations.length > 0) setSidebar(true) }}><IconEditOutline16 /><span className="niv-label">{t('annotate')}</span></button> : null}
        {annotations.length > 0 ? <button type="button" className="niv-button" data-active={sidebar} onClick={() => setSidebar(value => !value)}>{annotations.length} <span className="niv-label">{t('regions')}</span></button> : null}
        <button type="button" className="niv-button" aria-label={t('fit')} onClick={fit}><IconFullscreenOutline16 /><span className="niv-label">{t('fit')}</span></button>
        <button type="button" className="niv-button" onClick={actual}>{t('actual')}</button>
        <span className="niv-zoom">{Math.round(transform.zoom * 100)}%</span>
        <a className="niv-download" href={item.src} download={downloadName(item.name)}><IconDownloadOutline16 /><span className="niv-label">{t('download')}</span></a>
        <button type="button" className="niv-button niv-icon-only" aria-label={t('close')} onClick={() => service.close()}><IconCloseOutline16 /></button>
      </div>
    </header>
    <div className="niv-workspace" data-sidebar={sidebar} data-editor={request.editor !== undefined}>
      <main ref={stageRef} className="niv-stage" data-dragging={dragging} data-annotating={annotating} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onDoubleClick={() => { if (transform.zoom === 1) actual(); else fit() }}>
        <div ref={surfaceRef} className="niv-surface" onClick={addAnnotation} style={{ transform: `translate3d(${transform.x}px,${transform.y}px,0) scale(${transform.zoom})` }}>
          <img ref={imageRef} className="niv-image" src={item.src} alt={item.name} draggable="false" />
          {annotations.map((annotation, position) => <button type="button" className="niv-pin" data-active={selected === annotation.id} aria-label={fill(t('note'), { value: position + 1 })} style={{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, transform: `translate(-50%,-50%) scale(${1 / transform.zoom})` }} onClick={event => { event.stopPropagation(); setSelected(annotation.id); setSidebar(true); setFocusNote(annotation.id) }} key={annotation.id}>{position + 1}</button>)}
        </div>
        {showCounter ? <>
          <button type="button" className="niv-button niv-icon-only niv-nav niv-prev" aria-label={t('previous')} onClick={event => { event.stopPropagation(); setIndex(value => (value - 1 + request.items.length) % request.items.length) }}><IconChevronLeftOutline14 /></button>
          <button type="button" className="niv-button niv-icon-only niv-nav niv-next" aria-label={t('next')} onClick={event => { event.stopPropagation(); setIndex(value => (value + 1) % request.items.length) }}><IconChevronRightOutline14 /></button>
          <span className="niv-counter">{index + 1} / {request.items.length}</span>
        </> : annotating ? <span className="niv-hint">{t('regionHint')}</span> : transform.zoom === 1 ? <span className="niv-hint">{t('zoomHint')}</span> : null}
      </main>
      {sidebar ? <aside className="niv-sidebar" aria-label={t('regions')}>
        <header className="niv-sidebar-head"><div><strong>{t('regions')}</strong><small>{t('regionHint')}</small></div><button type="button" className="niv-button niv-icon-only" aria-label={t('hideNotes')} onClick={() => setSidebar(false)}><IconCloseOutline16 /></button></header>
        {annotations.length === 0 ? <p className="niv-sidebar-empty">{t('regionHint')}</p> : <div className="niv-note-list">{annotations.map((annotation, position) => <article className="niv-note" data-note-id={annotation.id} data-active={selected === annotation.id} key={annotation.id} onClick={() => setSelected(annotation.id)}>
          <span className="niv-note-index">{position + 1}</span>
          <textarea value={annotation.note} rows={3} aria-label={fill(t('note'), { value: position + 1 })} placeholder={t('notePlaceholder')} onFocus={() => setSelected(annotation.id)} onChange={event => { const note = event.target.value; setAnnotations(current => current.map(entry => entry.id === annotation.id ? { ...entry, note } : entry)) }} />
          <button type="button" className="niv-button niv-icon-only niv-note-remove" aria-label={t('removeNote')} onClick={event => { event.stopPropagation(); setAnnotations(current => current.filter(entry => entry.id !== annotation.id)); if (selected === annotation.id) setSelected(undefined) }}><IconCloseOutline16 /></button>
        </article>)}</div>}
        {annotations.some(annotation => annotation.note.trim() !== '') ? <footer className="niv-sidebar-foot"><button type="button" className="niv-button" onClick={() => { void copyNotes() }}><IconCopyOutline16 />{copied ? t('copied') : t('copyNotes')}</button></footer> : null}
      </aside> : null}
      {request.editor !== undefined ? <footer className="niv-editor">
        <Input value={prompt} placeholder={request.editor.placeholder} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
        {editorError ? <span className="niv-editor-error" role="alert">{request.editor.errorLabel ?? t('failed')}</span> : null}
        <Button type="button" disabled={busy} onClick={() => { void submit() }}>{busy ? request.editor.busyLabel ?? t('preparing') : request.editor.label}</Button>
      </footer> : null}
    </div>
  </div>
}

function installOfficialImageBridge(service) {
  const onClick = event => {
    const match = nativeImageButton(event.target)
    if (match === undefined) return
    const { items, index } = imageItemsForButton(match)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    service.open({ items, index, opener: match.button, source: 'dsh-native', annotations: true })
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}

export function apply(ctx) {
  const service = new NativeImageViewerService()
  ctx.effect(() => ctx.locale.register(name, LOCALES), `${name}: dictionaries`)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = name
    style.textContent = VIEWER_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, `${name}: styles`)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('nativeImageViewer', service)
    const disposeBridge = installOfficialImageBridge(service)
    return () => { disposeBridge(); void disposeService() }
  }, `${name}: optional viewer service and native image bridge`)
  const t = ctx.locale.bind(name)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: name, order: 20, inject: () => ({ service, t }),
  }, ViewerOverlay))
}

export { NativeImageViewerService, normalizeViewerRequest } from './viewer.js'
