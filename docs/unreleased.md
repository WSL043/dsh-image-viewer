# 1.0.0-alpha.1 — development candidate, not published


- 多图标注依次准备，每次只解码和编码一张图片；完成后释放位图与画布。
- 加入草稿期间可选择“仅关闭，不加入草稿”，或按 Escape / 关闭按钮取消本次操作。备注仍保留在当前页面，原有草稿不变。
- 停用插件会取消尚未完成的标注准备；旧操作完成或失败时不会关闭后来打开的图片。
- 提交状态变化不再重新移动焦点；关闭后的延迟焦点恢复会避开新打开的图片和已经移除的入口。

普通关闭仍将有变化的标注加入原会话草稿，失败时可重试，不会自动发送。此候选尚未发布；公开安装版本仍为 0.1.17。

## 已完成验收 / Acceptance evidence

main `2fc8da8b` 的 [Risk-based CI 40683783479](https://github.com/WSL043/dsh-image-viewer/actions/runs/40683783479) 九项作业全部成功，包含五个目标版本与一个 Portable 历史基线（`0.2.2-alpha.2`、`0.2.1-rc.4`、`0.2.1-rc.3`、`0.2.1-rc.2`、`0.2.1-rc.1`、`0.2.0-rc.2`）的 Windows 官方页面实测。覆盖图库、缩放、拖动、备注、下载和插件生命周期；本地受影响测试 53/53 通过。

这证明候选在上述测试页面的行为，不代表已经发布、验证用户现有安装、全部官方签名桌面包或真实模型调用。Portable 1.x 不预装本插件。

[CI 40683783479](https://github.com/WSL043/dsh-image-viewer/actions/runs/40683783479), on main `2fc8da8b`, passed all nine jobs, including Windows acceptance on five target DSH versions and one historical Portable baseline listed above. Tests cover gallery navigation, zoom, pan, notes, downloads and plugin lifecycle; 53 affected local tests also passed. This is scoped official-page evidence, not publication or validation of existing user installations, every signed desktop package or real model calls. Portable 1.x does not preinstall this plugin.
