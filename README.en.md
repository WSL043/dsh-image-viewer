> [!NOTE]
> This is an optional, independently removable DSH plugin. It enhances viewing, downloading, and region notes for images DSH already displays without taking over conversations, attachments, or model workflows. Image-producing plugins may also use it as a shared viewer when available.

<div align="center">

# DSH Image Viewer

Package: `dsh-image-viewer`. [Awesome DSH listing](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/WSL043__dsh-image-viewer.yml) · [Chat Manager](https://github.com/WSL043/dsh-chat-manager)

A compact, provider-neutral image viewer for DeepSeek Harness. It upgrades images already shown by DSH without replacing the conversation, attachment, or model workflows.

[![CI](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-image-viewer)
[![total npm downloads](https://img.shields.io/npm/dt/dsh-image-viewer?logo=npm&label=total%20downloads)](https://www.npmjs.com/package/dsh-image-viewer)
[![status](https://img.shields.io/badge/status-Stable%20release-15803d.svg)](#install)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-image-viewer?style=flat&logo=github&label=stars)](https://github.com/WSL043/dsh-image-viewer/stargazers)

[Install](#install) · [Privacy](#privacy) · [简体中文](README.md)

</div>

> Release 0.1.0 is published to npm. Unsupported image markup is left untouched instead of being guessed.

Stable and preview plugin releases are checked against their respective DSH targets using real attachments: gallery navigation, zoom, pan, download, region notes, and focus restoration. The six-hour workflow records official version tags and tests only the current plugin's declared target; it does not claim support for other versions or publish automatically.

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-image-viewer/main/docs/assets/image-viewer-en.png" width="900" alt="DSH Image Viewer displaying an illustration with fit, original-size, download, and an inline numbered region note">
</p>

## Features

- Wheel zoom centered on the pointer, drag-to-pan, touch pinch, and double-click 100% view.
- Fit and original-size controls, original-file download, keyboard navigation, and multi-image galleries.
- 0.1.1: download progress when the file size is available, cancellation and retry; switching images or closing the viewer cancels the active download.
- Visible filename, dimensions and pixel-scale percentage; very wide images can reach 100%, and window resizing keeps the image within reach.
- Loading and retryable error states, gesture reset on image changes, and independent notes for unnamed images.
- 0.1.1: closing an annotated native DSH image adds a numbered PNG and notes to the originating conversation draft, preserving existing text without sending. Unchanged notes are not added twice. Failed intake preserves notes with retry and close-only choices.
- One-shot region marking with each note edited beside its numbered image marker. Enter saves and collapses the note;
  Shift+Enter adds a new line.
- Light and dark themes through DSH design tokens, responsive layout, focus containment, and reduced-motion support.
- Optional `nativeImageViewer` client service so image-producing plugins can add their own continuation action.

DSH keeps working when the plugin is absent or cannot recognize a newer image surface. Other plugins may use the service when present, but must retain their own basic fallback.

## Install

### Official plugin page (recommended)

1. Open **Plugins → Add plugin** in DSH.
2. Paste this line into **Package name or address**, then select Install:

```text
dsh-image-viewer@0.1.2
```

3. Follow the result shown on the page. Refresh or restart only when requested. If installation fails, read its error before retrying.

**This version supports DSH 0.1.6-alpha.2 and 0.1.7-alpha.1.** Do not paste a complete `dsh plugin ...` command into the package field or treat the repository's `main` branch as a qualified release package.

For **DSH 0.1.7-rc.2**, install the preview `dsh-image-viewer@0.1.3-beta.3` in the same field. Use `0.1.3-beta.2` for DSH `0.1.7-rc.1` or `0.1.3-beta.1` for `0.1.7-alpha.2`. The preview does not replace the npm stable tag. Follow the page's refresh or restart instruction after installation.

### Terminal installation (optional)

Run in the DSH or Portable terminal:

```sh
dsh plugin --profile web add dsh-image-viewer@0.1.2
```

If DSH is running, save your work and restart after this terminal operation to load the change. For older cores, choose the plugin version verified in its release notes.

## Update

Use the installed plugin’s update action on the official **Plugins** page. If it is unavailable, use **Add plugin** with the published target `package@version`. Refresh or restart only when requested. The version-pinned terminal command above is an alternative.

## Uninstall

Uninstall this plugin from the official **Plugins** page, or use the terminal:

```sh
dsh plugin --profile web remove dsh-image-viewer
```

Uninstalling restores DSH's built-in image lightbox. It does not remove conversations, attachments, generated images, provider plugins, or credentials.

## Custom download integration

When calling `nativeImageViewer.open()`, an item's `download.onInvoke` receives `{ item, src, signal, onProgress }`. Pass `signal` to the download request and report bytes through `onProgress({ loaded, total })`. Omit `total` when the size is unknown; the viewer shows a preparing state and a cancel button.

Existing callbacks remain compatible. Custom transfers must honor `signal` to stop their underlying work. The viewer ignores late progress and results from cancelled operations. Download authorization and original-file integrity checks remain the image provider's responsibility.

## Privacy

The plugin reads only URLs already rendered by DSH, does not call a model, and does not read provider credentials. The annotation workflow adds images and notes through DSH's attachment and draft APIs; the user decides whether to send. Notes remain available when reopening an image within the current page, which does not imply a sent message or permanent conversation storage.

## Support

Open the [bug report form](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) with the exact plugin version, DSH version, operating system, image location (message or composer), and the action that failed. Do not include private images, credentials, or full session logs. Report sensitive security problems privately through [GitHub Security Advisories](https://github.com/WSL043/dsh-image-viewer/security/advisories/new).

## License

[简体中文](README.md) · [Report a bug](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) · [Request a feature](https://github.com/WSL043/dsh-image-viewer/issues/new?template=feature-request.yml) · [MIT](LICENSE)
