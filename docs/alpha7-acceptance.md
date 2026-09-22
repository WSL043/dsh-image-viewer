# DSH 0.1.7-alpha.1 candidate acceptance

The official UI primitives renamed sized icon exports. The previous client throws React error 130 when opening the viewer on this core; the overlay error boundary catches it, so `pageerror` alone does not detect the failure. Browser acceptance must also observe console errors and whether the viewer actually opens.

The client now resolves official Regular icons, falling back to the older sized exports for previously supported cores. It does not copy official icons or replace the workspace/composer.

Actual published DSH 0.1.7-alpha.1 ran in an isolated synthetic profile on Windows. Headless Chrome passed gallery navigation, zoom/pan, annotation add/remove, image download, Escape/focus restoration, and annotated-image plus notes returned to the original draft without losing its existing text. The returned draft screenshot was visually inspected. Source tests: 31 passed; client/server build passed.

Evidence: `.artifacts/alpha7-image-acceptance.log` and `.artifacts/alpha7-image-diagnostic.log` preserve the original failure. `.artifacts/alpha7-image-fixed.log` and `.artifacts/alpha7-image-fixed/` contain passing output and screenshots. Synthetic images were generated in the browser; no user images, credentials or sessions were used. The local acceptance copy handles onboarding with real buttons instead of removing dialogs from the DOM.

This is not native WebView2, a published package, a V3/V4 attachment migration test, or proof of every previous core. Compatibility declarations and package version remain unchanged pending distribution qualification.
