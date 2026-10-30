> The `dsh-image-viewer@1.0.0-alpha.1` candidate has passed acceptance on six official DSH pages and is not published. See the [candidate evidence](docs/unreleased.md) for scope; installation below uses the npm `latest` stable release, whose support window is independent of the candidate.

<div align="center">

# DSH Image Viewer

A lightweight viewer for zooming, browsing, downloading, and annotating images already shown by DSH.

[![CI](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-image-viewer)
[![total npm downloads](https://img.shields.io/npm/dt/dsh-image-viewer?logo=npm&label=total%20downloads)](https://www.npmjs.com/package/dsh-image-viewer)
[![status](https://img.shields.io/badge/status-Stable%20release-15803d.svg)](#install)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-image-viewer?style=flat&logo=github&label=stars)](https://github.com/WSL043/dsh-image-viewer/stargazers)

[中文](README.md) · [Install](#install) · [Privacy](#privacy)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-image-viewer/main/docs/assets/image-viewer-en.png" width="900" alt="DSH Image Viewer with zoom, download, and a numbered region note">
</p>

## Features

- Pointer-centered zoom, drag, touch pinch, double-click 100%, fit/original-size controls, keyboard navigation, and multi-image galleries.
- Shows filenames, dimensions, and scale; large images can reach 100% and stay visible when the window is resized.
- Original-file downloads show available progress and can be cancelled or retried; switching images or closing the viewer cancels a download.
- Clear loading and retryable error states; image changes reset gestures and keep annotations separate.
- Mark image regions and edit notes beside their numbered markers. Enter saves; Shift+Enter adds a line.
- Closing an annotated native DSH image adds its numbered PNG and notes to the current draft without sending or duplicating them; failures remain retryable.
- DSH light/dark themes, responsive layout, focus containment, and reduced-motion support.

## Install

New [DSH-Portable](https://github.com/WSL043/DSH-Portable) packages starting with 0.9.9 will no longer preinstall community plugins. Install this plugin if wanted; existing plugin installations in older packages are preserved. The 1.x official-desktop portable line also does not preinstall community plugins.

### Plugin page (recommended)

1. Check the target DSH, profile, actual version resolved by `latest`, and its peer requirements before opening **Plugins → Add plugin**.
2. Paste this line into **Package name or address**, then select Install:

```text
dsh-image-viewer@latest
```

3. Follow the result shown on the page; refresh or restart only when requested.

<!-- dsh-compatibility -->
See the [stable maintenance branch](https://github.com/WSL043/dsh-image-viewer/blob/stable/README.en.md#install) for the stable support window and [stable AGENTS.md](https://github.com/WSL043/dsh-image-viewer/blob/stable/AGENTS.md) for installation protections. The candidate peer range does not replace them.
<!-- /dsh-compatibility -->

Stable maintenance checks upstream every hour. Compatibility patches publish automatically to npm and GitHub Releases after acceptance; failures block publication and report an error. This process does not publish or widen support for this branch's candidate.

### Terminal (optional)

For official DSH Desktop, install its bundled command through **Manage dsh Command…**; after initialization, fully quit the app before using `--profile desktop`. DSH-Portable 0.x and the Web profile use `--profile web`.

```sh
dsh plugin --profile desktop add dsh-image-viewer@latest
dsh plugin --profile web add dsh-image-viewer@latest
```

After a terminal operation, restart the corresponding profile as prompted by the host.

## Update and uninstall

Update or uninstall from the **Plugins** page. If no update action is offered, enter the target `package@version` under **Add plugin**. To uninstall from a terminal, run `dsh plugin --profile web remove dsh-image-viewer`; for official Desktop, quit the app and use the `desktop` profile as described above.

Uninstalling restores DSH's built-in image viewer and does not delete conversations or images.

## Privacy

The plugin reads only image URLs already rendered by DSH; it does not call a model or read provider credentials. Annotations use DSH's attachment and draft APIs, leaving the decision to send with the user. Reopening an image in the current page may retain its note; this does not mean it was sent or permanently stored.

## Support

Use the [bug report form](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) with the plugin/DSH versions, operating system, image location, and failed action. Do not include private images, credentials, or full session logs. Report security issues privately through [GitHub Security Advisories](https://github.com/WSL043/dsh-image-viewer/security/advisories/new).

## License and quality

[MIT](LICENSE). Each declared core is checked in the live interface.

## Developers

When calling `nativeImageViewer.open()`, `download.onInvoke` receives `{ item, src, signal, onProgress }`. Pass `signal` to the download request and report bytes with `onProgress({ loaded, total })`; omit `total` when the size is unknown. Custom transfers must honor `signal` to support cancellation. Download authorization and original-file checks remain the image provider's responsibility.

[简体中文](README.md) · [Awesome DSH listing](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/WSL043__dsh-image-viewer.yml) · [Chat Manager](https://github.com/WSL043/dsh-chat-manager)
