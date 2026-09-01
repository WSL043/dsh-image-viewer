> [!NOTE]
> This is an optional, independently removable DSH plugin. It enhances viewing, downloading, and region notes for images DSH already displays without taking over conversations, attachments, or model workflows. Image-producing plugins may also use it as a shared viewer when available.

<div align="center">

# DSH Image Viewer

A compact, provider-neutral image viewer for DeepSeek Harness. It upgrades images already shown by DSH without replacing the conversation, attachment, or model workflows.

[![CI](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-image-viewer)
[![total npm downloads](https://img.shields.io/npm/dt/dsh-image-viewer?logo=npm&label=total%20downloads)](https://www.npmjs.com/package/dsh-image-viewer)
[![status](https://img.shields.io/badge/status-Beta-7c3aed.svg)](#install)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-image-viewer?style=flat&logo=github&label=stars)](https://github.com/WSL043/dsh-image-viewer/stargazers)

[Install](#install) · [Privacy](#privacy) · [简体中文](README.md)

</div>

> Beta: the viewer targets the latest public DSH release. Unsupported image markup is left untouched instead of being guessed.

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-image-viewer/main/docs/assets/image-viewer-en.png" width="900" alt="DSH Image Viewer displaying an illustration with fit, original-size, download, and an inline numbered region note">
</p>

## Features

- Wheel zoom centered on the pointer, drag-to-pan, touch pinch, and double-click 100% view.
- Fit and original-size controls, original-file download, keyboard navigation, and multi-image galleries.
- One-shot region marking with each note edited beside its numbered image marker. Enter saves and collapses the note;
  Shift+Enter adds a new line.
- Light and dark themes through DSH design tokens, responsive layout, focus containment, and reduced-motion support.
- Optional `nativeImageViewer` client service so image-producing plugins can add their own continuation action.

DSH keeps working when the plugin is absent or cannot recognize a newer image surface. Other plugins may use the service when present, but must retain their own basic fallback.

## Install

Install the Beta:

```sh
dsh plugin --profile web add dsh-image-viewer@0.1.0-beta.7
```

Restart DSH manually after saving active work. The plugin never needs access to provider credentials or image-generation accounts.

## Update

Run the same version-pinned `dsh plugin ... add` command for the version you want to install.

## Uninstall

```sh
dsh plugin --profile web remove dsh-image-viewer
```

Uninstalling restores DSH's built-in image lightbox. It does not remove conversations, attachments, generated images, provider plugins, or credentials.

## Privacy

Image bytes stay in the current browser profile. The plugin reads only URLs already rendered by DSH, does not upload images, does not call a model, and does not read provider credentials. Region notes remain available when the same image is reopened during the current DSH page session, but are not written to conversation storage unless another plugin explicitly uses them for a user-requested action.

## Support

Open the [bug report form](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) with the exact plugin version, DSH version, operating system, image location (message or composer), and the action that failed. Do not include private images, credentials, or full session logs. Report sensitive security problems privately through [GitHub Security Advisories](https://github.com/WSL043/dsh-image-viewer/security/advisories/new).

## License

[简体中文](README.md) · [Report a bug](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) · [Request a feature](https://github.com/WSL043/dsh-image-viewer/issues/new?template=feature-request.yml) · [MIT](LICENSE)
