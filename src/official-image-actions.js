// Add an explicit action to the official menu; normal image clicks stay official.
export function registerImageAnnotations(ctx, service, { label, createCommit }) {
  return ctx.contextMenus.register({
    id: 'dsh-image-viewer.annotations', target: 'image', order: 500,
    resolve(target) {
      if (typeof target?.url !== 'string' || target.url === '') return []
      const opener = typeof document === 'undefined' ? undefined : document.activeElement
      return [{
        id: 'dsh-image-viewer.annotate', label: label(),
        run: () => service.open({
          items: [{ id: target.url, src: target.url, name: target.name || 'Image' }],
          opener, source: 'dsh-context-menu', annotations: true,
          commitAnnotations: createCommit(target),
        }),
      }]
    },
  })
}
