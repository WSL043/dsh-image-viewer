> [!NOTE]
> 这是一个可选、可独立卸载的 DSH 插件。它增强 DSH 已显示图片的查看、下载与区域标注，不接管会话、附件或模型流程；图片生成插件也可以按需把它作为共享查看器使用。

<div align="center">

# DSH Image Viewer · 图片查看器

面向 DeepSeek Harness 的简洁、与模型和供应商无关的图片查看器。它只增强 DSH 已经显示的图片，不替换会话、附件或模型流程。

插件包名：`dsh-image-viewer`。支持图片缩放、原图下载、图库浏览与区域标注。[Awesome DSH 收录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/WSL043__dsh-image-viewer.yml) · [会话管理插件](https://github.com/WSL043/dsh-chat-manager)

[![CI](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-image-viewer)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-image-viewer?logo=npm&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-image-viewer)
[![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-Stable%20release-15803d.svg)](#安装)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-image-viewer?style=flat&logo=github&label=stars)](https://github.com/WSL043/dsh-image-viewer/stargazers)

[安装](#安装) · [隐私](#隐私) · [English](README.en.md)

</div>

> 请按下方说明选择与内核匹配的已发布版本。旧发布记录不代表支持所有后续 Alpha。

稳定版与当前 Alpha 都在隔离环境验收真实附件的多图切换、缩放、拖动、下载、区域备注及关闭后焦点恢复。发布前必须通过；定时工作流每六小时检查官方新版本，失败保留浏览器和启动记录，不自动宣称兼容或发布。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-image-viewer/main/docs/assets/image-viewer-zh.png" width="900" alt="DSH 图片查看器展示插画、适应窗口、原始大小、下载和图片编号附近的区域备注">
</p>

## 功能

- 以鼠标位置为中心的滚轮缩放、拖动查看、触控双指缩放和双击原始大小。
- 适应窗口、原始大小、原图下载、键盘切换和多图浏览。
- 0.1.1：下载时显示可用的进度，支持取消和重试；切换图片或关闭查看器会取消正在进行的下载。
- 显示图片名称、尺寸与真实像素缩放比例；超宽大图也能切换到 100%，调整窗口后保持图片可见。
- 图片加载中和加载失败都有明确提示，失败可重试；切换图片会重置拖拽状态，区域备注不会串到另一张未命名图片。
- 一次点击标记一个区域，备注直接显示在图片编号附近并自动获得输入焦点；Enter 保存并收起，Shift+Enter 换行。
- 0.1.1：在 DSH 原生图片入口添加备注后，关闭查看器会把带编号的 PNG 和备注加入打开图片时的会话草稿，保留已有文字，不自动发送。没有修改备注时不会重复添加；失败时保留标注并可重试或仅关闭。
- 使用 DSH 设计令牌适配亮色、暗色、响应式布局、焦点约束和减少动态效果设置。
- 提供可选的 `nativeImageViewer` 客户端服务，图片生成插件可以按需增加自己的后续操作。

未安装本插件或插件无法识别更新后的图片界面时，DSH 仍保持原有查看能力。其他插件可以在检测到服务时使用高级查看，但仍应保留自己的基础回退。

## 安装

### 在官方插件页面安装（推荐）

1. 打开 DSH 的 **插件 → 添加插件**。
2. 在“包名或地址”中粘贴下面这一行，再点击安装：

```text
dsh-image-viewer@0.1.2
```

3. 查看安装结果；仅在页面要求时刷新或重启。安装失败时留在插件页查看错误，不必重复安装。

**此版本兼容 DSH 0.1.6-alpha.2 和 0.1.7-alpha.1。** 不要把整条 `dsh plugin ...` 命令粘贴进包名框，也不要把仓库的 `main` 分支当作已验证发布包。

使用 **DSH 0.1.7-alpha.2** 时，改为在同一输入框安装预览版 `dsh-image-viewer@0.1.3-beta.1`；它不会替换 npm 的稳定版标签。确认安装结果后按页面提示刷新或重启。

### 终端安装（可选）

在 DSH 或 Portable 的终端中执行：

```sh
dsh plugin --profile web add dsh-image-viewer@0.1.2
```

如果 DSH 正在运行，命令完成后保存工作并重新启动，以加载终端改动。旧内核请选择对应发布说明中已验证的插件版本。

## 更新

在官方 **插件** 页面使用已安装插件的更新操作；没有更新按钮时，在“添加插件”中填写已发布的目标 `包名@版本`。仅按页面提示刷新或重启。也可使用上面的终端命令安装目标版本。

## 卸载

在官方 **插件** 页面找到本插件并选择卸载，或使用终端：

```sh
dsh plugin --profile web remove dsh-image-viewer
```

卸载后恢复 DSH 内置图片灯箱，不会删除会话、附件、生成图片、供应商插件或凭据。

## 自定义下载接入

调用 `nativeImageViewer.open()` 时，图片条目的 `download.onInvoke` 会收到 `{ item, src, signal, onProgress }`。将 `signal` 传给下载请求，并通过 `onProgress({ loaded, total })` 上报字节数。文件总大小未知时省略 `total`，查看器显示准备状态和取消按钮。

旧的下载回调仍可使用；要实际停止自定义传输，回调需要响应 `signal`。查看器会忽略已取消操作的迟到进度和结果。下载权限及原图完整性校验仍由提供图片的插件负责。

## 隐私

插件只读取 DSH 已经渲染的图片 URL，不调用模型或读取供应商凭据。支持标注回填的版本通过 DSH 的附件与输入框接口加入当前草稿，由用户决定是否发送。当前页面内重新打开同一张图片时，区域备注仍会保留；这不等于已发送或永久保存会话。

## 反馈

请通过[问题反馈表单](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml)提供准确的插件版本、DSH 版本、操作系统、图片所在位置（消息或输入框）以及失败的操作。不要提交私人图片、凭据或完整会话日志。敏感安全问题请通过 [GitHub Security Advisories](https://github.com/WSL043/dsh-image-viewer/security/advisories/new) 私下报告。

## 许可证

[English](README.en.md) · [反馈问题](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) · [功能建议](https://github.com/WSL043/dsh-image-viewer/issues/new?template=feature-request.yml) · [MIT](LICENSE)
