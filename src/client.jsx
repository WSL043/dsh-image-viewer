import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
  IconCopyOutline16, IconDownloadOutline16, IconEditOutline16, IconFullscreenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  imageItemsForButton, NativeImageViewerService, nativeImageButton,
} from './viewer.js'
import { CSS as VIEWER_CSS } from './styles.js'
import { useImageTransform } from './image-transform.js'

export const name = 'dsh-image-viewer'
export const inject = ['locale', 'slots']

const LOCALES = {
  en: {
    dialog: 'Image viewer', close: 'Close', fit: 'Fit', actual: '100%', download: 'Download',
    annotate: 'Mark region', cancelAnnotate: 'Cancel marking', regions: 'Region notes', regionHint: 'Click a point on the image, then add a note.',
    note: 'Region {value}', notePlaceholder: 'Describe what should change here…', removeNote: 'Remove region note',
    hideNotes: 'Hide notes', copyNotes: 'Copy notes', copied: 'Copied', previous: 'Previous image', next: 'Next image',
    zoomHint: 'Wheel to zoom · drag to pan · double-click for 100%', preparing: 'Preparing…', failed: 'Could not prepare this image.',
    loading: 'Loading image…', loadFailed: 'Image could not be loaded.', retry: 'Retry', copyFailed: 'Copy failed. Try again.',
  },
  zh: {
    dialog: '图片查看器', close: '关闭', fit: '适应窗口', actual: '原始大小', download: '下载',
    annotate: '标记区域', cancelAnnotate: '取消标记', regions: '区域备注', regionHint: '点击图片中的位置，然后填写备注。',
    note: '区域 {value}', notePlaceholder: '描述这里需要怎样调整…', removeNote: '删除区域备注',
    hideNotes: '收起备注', copyNotes: '复制备注', copied: '已复制', previous: '上一张图片', next: '下一张图片',
    zoomHint: '滚轮缩放 · 拖动查看 · 双击切换原始大小', preparing: '正在准备…', failed: '暂时无法准备这张图片。',
    loading: '正在加载图片…', loadFailed: '图片加载失败。', retry: '重试', copyFailed: '复制失败，请重试。',
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

function ViewerAction({ action, annotations, item, service }) {
  const [state, setState] = useState('idle')
  const invoke = async () => {
    if (state === 'pending') return
    setState('pending')
    try {
      await action.onInvoke({ annotations, item, src: item.src })
      setState('idle')
      if (action.closeOnSuccess) service.close()
    } catch { setState('failed') }
  }
  const label = state === 'pending' ? action.pendingLabel : state === 'failed' ? action.errorLabel : action.label
  return <button type="button" className="niv-button" disabled={state === 'pending'} onClick={() => { void invoke() }}><span className="niv-label">{label}</span></button>
}

function ViewerDownload({ download, item, t }) {
  const [state, setState] = useState('idle')
  const invoke = async () => {
    if (state === 'pending') return
    setState('pending')
    try { await download.onInvoke({ item, src: item.src }); setState('idle') } catch { setState('failed') }
  }
  const label = state === 'pending' ? download.pendingLabel ?? t('preparing') : state === 'failed' ? download.errorLabel ?? t('failed') : t('download')
  return <button type="button" className="niv-download" disabled={state === 'pending'} onClick={() => { void invoke() }}><IconDownloadOutline16 /><span className="niv-label">{label}</span></button>
}

function ViewerOverlay({ service, t }) {
  const request = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const [index, setIndex] = useState(0)
  const [imageState, setImageState] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [copyFailed, setCopyFailed] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [annotationsByImage, setAnnotationsByImage] = useState(service.getAnnotationsSnapshot)
  const annotationsByImageRef = useRef(annotationsByImage)
  const [selected, setSelected] = useState()
  const [focusNote, setFocusNote] = useState()
  const [copied, setCopied] = useState(false)
  const rootRef = useRef(null)
  annotationsByImageRef.current = annotationsByImage

  useEffect(() => {
    if (request === undefined) return
    setIndex(request.index)
    setAnnotating(false)
    setSelected(undefined)
    setCopied(false)
  }, [request?.revision])

  const item = request?.items[index]
  const { transform, transformRef, dragging, pixelScale, stageRef, surfaceRef, imageRef, fit, actual, measure, setZoomAt, resetGesture, pointerHandlers } = useImageTransform(`${request?.revision}:${item?.id}:${item?.src}`)
  const annotations = item === undefined ? [] : annotationsByImage[item.id] ?? []
  const setAnnotations = useCallback((update) => {
    if (item === undefined) return
    const previous = annotationsByImageRef.current[item.id] ?? []
    const next = typeof update === 'function' ? update(previous) : update
    const snapshot = { ...annotationsByImageRef.current, [item.id]: next }
    annotationsByImageRef.current = snapshot
    service.setAnnotations(item.id, next)
    setAnnotationsByImage(snapshot)
  }, [item?.id, service])

  useEffect(() => {
    if (request === undefined) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.focus()
    const onKeyDown = event => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (event.target instanceof Element && event.target.closest('.niv-inline-note') !== null) {
          setSelected(undefined)
          return
        }
        service.close()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]') !== null
      if (!editing && ['ArrowLeft', 'ArrowRight', '+', '=', '-', 'f', 'F'].includes(event.key)) event.stopPropagation()
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
        if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === rootRef.current)) { event.preventDefault(); first?.focus() }
      }
    }
    const root = rootRef.current
    root.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [request, service, fit, setZoomAt])

  useEffect(() => {
    if (focusNote === undefined) return
    const field = rootRef.current?.querySelector(`[data-note-id="${CSS.escape(focusNote)}"] textarea`)
    field?.focus()
    setFocusNote(undefined)
  }, [focusNote, selected, annotations.length])

  useEffect(() => {
    setAnnotating(false)
    setSelected(undefined)
    setImageState('loading')
    setCopyFailed(false)
    setCopied(false)
  }, [item?.id, item?.src, request?.revision])

  const addAnnotation = event => {
    if (!annotating || event.target.closest('.niv-annotation')) return
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (bounds === undefined) return
    const annotation = {
      id: crypto.randomUUID(),
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      note: '',
    }
    setAnnotations(current => [...current, annotation])
    setAnnotating(false)
    setSelected(annotation.id)
    setFocusNote(annotation.id)
  }
  const copyNotes = async () => {
    const text = noteText(annotations, t)
    if (text === '') return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setCopyFailed(false)
    } catch { setCopyFailed(true) }
  }

  if (request === undefined || item === undefined) return null
  const meta = [item.width && item.height ? `${item.width} × ${item.height}` : undefined, bytesLabel(item.bytes)].filter(Boolean).join(' · ')
  const showCounter = request.items.length > 1
  return <div ref={rootRef} className="niv-root" role="dialog" aria-modal="true" aria-label={t('dialog')} tabIndex={-1}>
    <div className="niv-title"><strong>{item.name}</strong>{meta !== '' ? <small>{meta}</small> : null}</div>
    <header className="niv-topbar" role="toolbar" aria-label={t('dialog')}>
      <div className="niv-actions">
        {request.annotations ? <button type="button" className="niv-button" data-active={annotating} aria-label={annotating ? t('cancelAnnotate') : t('annotate')} aria-pressed={annotating} disabled={imageState !== 'ready'} onClick={() => { resetGesture(); setAnnotating(value => !value) }}><IconEditOutline16 /><span className="niv-label">{annotating ? t('cancelAnnotate') : t('annotate')}</span></button> : null}
        {annotations.length > 0 ? <button type="button" className="niv-button" data-active={selected !== undefined} onClick={() => { const first = annotations[0]; setSelected(current => current === undefined ? first.id : undefined); if (selected === undefined) setFocusNote(first.id) }}>{annotations.length} <span className="niv-label">{t('regions')}</span></button> : null}
        <button type="button" className="niv-button" aria-label={t('fit')} onClick={fit}><IconFullscreenOutline16 /><span className="niv-label">{t('fit')}</span></button>
        <button type="button" className="niv-button" disabled={imageState !== 'ready'} onClick={actual}>{t('actual')}</button>
        <span className="niv-zoom">{Math.round(transform.zoom * pixelScale * 100)}%</span>
        {item.download === undefined
          ? <a className="niv-download" href={item.src} download={downloadName(item.name)}><IconDownloadOutline16 /><span className="niv-label">{t('download')}</span></a>
          : <ViewerDownload key={item.src} download={item.download} item={item} t={t} />}
        {item.actions.map(action => <ViewerAction action={action} annotations={annotations} item={item} service={service} key={`${item.src}:${action.id}`} />)}
      </div>
    </header>
    <button type="button" className="niv-close-floating" aria-label={t('close')} onClick={() => service.close()}><IconCloseOutline16 /></button>
    <div className="niv-workspace">
      <main ref={stageRef} className="niv-stage" data-dragging={dragging} data-annotating={annotating} onClick={event => { if (event.target === event.currentTarget && !annotating && transform.zoom === 1) service.close() }} {...(!annotating && imageState === 'ready' ? pointerHandlers : {})} onDoubleClick={event => { if (event.target.closest('button,a,input,textarea') || imageState !== 'ready') return; if (transform.zoom === 1) actual(); else fit() }}>
        {imageState !== 'ready' ? <div className="niv-load-status" role={imageState === 'error' ? 'alert' : 'status'}>{t(imageState === 'error' ? 'loadFailed' : 'loading')}{imageState === 'error' ? <button type="button" className="niv-button" onClick={() => { setImageState('loading'); setAttempt(value => value + 1) }}>{t('retry')}</button> : null}</div> : null}
        <div ref={surfaceRef} className="niv-surface" onClick={addAnnotation} style={{ visibility: imageState === 'ready' ? 'visible' : 'hidden', transform: `translate3d(${transform.x}px,${transform.y}px,0) scale(${transform.zoom})` }}>
          <img key={`${request.revision}:${item.id}:${attempt}`} ref={imageRef} className="niv-image" src={item.src} alt={item.name} draggable="false" onLoad={() => { setImageState('ready'); measure() }} onError={() => setImageState('error')} />
          {annotations.map((annotation, position) => <div className="niv-annotation" data-x={annotation.x < 0.38 ? 'right' : annotation.x > 0.62 ? 'left' : 'center'} data-y={annotation.y < 0.28 ? 'down' : 'up'} style={{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, transform: `translate(-50%,-50%) scale(${1 / transform.zoom})` }} key={annotation.id}>
            <button type="button" className="niv-pin" data-active={selected === annotation.id} aria-label={fill(t('note'), { value: position + 1 })} onClick={event => { event.stopPropagation(); const opening = selected !== annotation.id; setSelected(opening ? annotation.id : undefined); if (opening) setFocusNote(annotation.id) }}>{position + 1}</button>
            {selected === annotation.id ? <div className="niv-inline-note" data-note-id={annotation.id} onClick={event => event.stopPropagation()}>
              <span className="niv-inline-index">{position + 1}</span>
              <textarea value={annotation.note} rows={1} aria-label={fill(t('note'), { value: position + 1 })} placeholder={t('notePlaceholder')} onChange={event => { const note = event.target.value; setAnnotations(current => current.map(entry => entry.id === annotation.id ? { ...entry, note } : entry)) }} onKeyDown={event => {
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  event.nativeEvent?.stopImmediatePropagation?.()
                  setSelected(undefined)
                }
              }} />
              <button type="button" className="niv-note-remove" aria-label={t('removeNote')} onClick={event => { event.stopPropagation(); setAnnotations(current => current.filter(entry => entry.id !== annotation.id)); setSelected(undefined) }}><IconCloseOutline16 /></button>
            </div> : null}
          </div>)}
        </div>
        {showCounter ? <>
          <button type="button" className="niv-button niv-icon-only niv-nav niv-prev" aria-label={t('previous')} onClick={event => { event.stopPropagation(); setIndex(value => (value - 1 + request.items.length) % request.items.length) }}><IconChevronLeftOutline14 /></button>
          <button type="button" className="niv-button niv-icon-only niv-nav niv-next" aria-label={t('next')} onClick={event => { event.stopPropagation(); setIndex(value => (value + 1) % request.items.length) }}><IconChevronRightOutline14 /></button>
          <span className="niv-counter">{index + 1} / {request.items.length}</span>
        </> : annotating ? <span className="niv-hint">{t('regionHint')}</span> : transform.zoom === 1 ? <span className="niv-hint">{t('zoomHint')}</span> : null}
      </main>
      {annotations.some(annotation => annotation.note.trim() !== '') ? <button type="button" className="niv-copy-notes" onClick={() => { void copyNotes() }}><IconCopyOutline16 />{copyFailed ? t('copyFailed') : copied ? t('copied') : t('copyNotes')}</button> : null}
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
