# Agent installation guide

Use this guide only when the user asks to install, update, verify, or remove `dsh-image-viewer` in a selected DeepSeek Harness Web profile.

## Safety

- Confirm the target DSH installation and profile.
- Install the exact requested version; do not install a moving branch.
- Preserve conversations, attachments, unrelated plugins, settings, and credentials.
- Do not start, stop, or restart DSH without permission.
- Never copy, upload, or expose the user's images as part of installation verification.

## Install or update

```sh
dsh plugin --profile web add ./dsh-image-viewer-0.1.0.tgz
```

DSH-Portable exposes the same standard `dsh plugin` command. Do not use a private executable path in public instructions.

## Verify

```sh
dsh plugin --profile web list dsh-image-viewer --depth 0
dsh --profile web --dump-config
```

Confirm the package and `wsl043-native-image-viewer` bundle each appear exactly once. With permission to restart DSH, use a non-sensitive local test image to verify message and composer entry points, pointer-centered wheel zoom, drag pan, download, Escape, focus restoration, and the collapsed region-note sidebar.

## Uninstall

```sh
dsh plugin --profile web remove dsh-image-viewer
```

Verify the package and bundle row are absent. Uninstall must preserve images, sessions, credentials, settings, and unrelated plugins.

## Failure handling

Separate package installation, DSH composition, unsupported image markup, browser capability, and file-download failures. Unsupported image markup must retain DSH's built-in behavior. Do not patch installed DSH files, disable browser security, or upload a user's image to reproduce a viewer issue.
