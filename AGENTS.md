> Development candidate: `dsh-image-viewer@1.0.0-alpha.1` has passed the scoped six-version official-page acceptance linked in docs/unreleased.md and is not published. Do not substitute it for the npm `latest` stable release below.

> Stable support and installation protections: [stable README](https://github.com/WSL043/dsh-image-viewer/blob/stable/README.md) and [stable AGENTS.md](https://github.com/WSL043/dsh-image-viewer/blob/stable/AGENTS.md). Candidate compatibility does not carry over.

# Agent installation guide

Use this guide only when the user asks to install, update, verify, or remove `dsh-image-viewer` in a selected DeepSeek Harness Web profile.

## Safety

- Confirm the target DSH installation and profile.
- Install the exact requested npm version. For `dsh-image-viewer@latest`, first resolve its actual registry version, check its peer requirements against the target DSH and profile, then install that exact version; never install a moving source branch.
- Preserve conversations, attachments, unrelated plugins, settings, and credentials.
- Do not start, stop, or restart DSH without permission.
- Never copy, upload, or expose the user's images as part of installation verification.

## Install or update

Read the dynamic stable guides above before an authorized installation. Replace `VERSION` below with the verified resolved npm version; use `web` only for the selected Web profile.

```sh
dsh plugin --profile web add dsh-image-viewer@VERSION
```

DSH-Portable exposes the same standard `dsh plugin` command. Do not use a private executable path in public instructions.

Stable maintenance checks upstream every hour and publishes compatible patches to npm and GitHub Releases only after acceptance. Failures block publication and report an error; the unpublished candidate remains outside that process.

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
