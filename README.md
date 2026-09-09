> [!NOTE]
> 这是一个可选、可独立卸载的 DSH 插件。它增强 DSH 已显示图片的查看、下载与区域标注，不接管会话、附件或模型流程；图片生成插件也可以按需把它作为共享查看器使用。

<div align="center">

# DSH 图片查看器

面向 DeepSeek Harness 的简洁、与模型和供应商无关的图片查看器。它只增强 DSH 已经显示的图片，不替换会话、附件或模型流程。

[![CI](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-image-viewer)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-image-viewer?logo=npm&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-image-viewer)
[![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-Stable%20release-15803d.svg)](#安装)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/WSL043/dsh-image-viewer?style=flat&logo=github&label=stars)](https://github.com/WSL043/dsh-image-viewer/stargazers)

[安装](#安装) · [隐私](#隐私) · [English](README.en.md)

</div>

> 正式版 0.1.0 已发布到 npm。遇到无法识别的新图片结构时会保留 DSH 原生行为，不会猜测接管。

稳定版与当前 Alpha 都在隔离环境验收真实附件的多图切换、缩放、拖动、下载、区域备注及关闭后焦点恢复。发布前必须通过；定时工作流每六小时检查官方新版本，失败保留浏览器和启动记录，不自动宣称兼容或发布。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-image-viewer/main/docs/assets/image-viewer-zh.png" width="900" alt="DSH 图片查看器展示插画、适应窗口、原始大小、下载和图片编号附近的区域备注">
</p>

## 功能

- 以鼠标位置为中心的滚轮缩放、拖动查看、触控双指缩放和双击原始大小。
- 适应窗口、原始大小、原图下载、键盘切换和多图浏览。
- 下一版 0.1.1：下载时显示可用的进度，支持取消和重试；切换图片或关闭查看器会取消正在进行的下载。
- 显示图片名称、尺寸与真实像素缩放比例；超宽大图也能切换到 100%，调整窗口后保持图片可见。
- 图片加载中和加载失败都有明确提示，失败可重试；切换图片会重置拖拽状态，区域备注不会串到另一张未命名图片。
- 一次点击标记一个区域，备注直接显示在图片编号附近并自动获得输入焦点；Enter 保存并收起，Shift+Enter 换行。
- 使用 DSH 设计令牌适配亮色、暗色、响应式布局、焦点约束和减少动态效果设置。
- 提供可选的 `nativeImageViewer` 客户端服务，图片生成插件可以按需增加自己的后续操作。

未安装本插件或插件无法识别更新后的图片界面时，DSH 仍保持原有查看能力。其他插件可以在检测到服务时使用高级查看，但仍应保留自己的基础回退。

## 安装

从 npm 安装正式版：

```sh
dsh plugin --profile web add dsh-image-viewer@0.1.0
```

保存正在进行的工作后手动重启 DSH。本插件不需要供应商凭据或图片生成账户权限。

## 更新

使用目标版本对应的固定 `dsh plugin ... add` 命令更新。

## 卸载

```sh
dsh plugin --profile web remove dsh-image-viewer
```

卸载后恢复 DSH 内置图片灯箱，不会删除会话、附件、生成图片、供应商插件或凭据。

## 自定义下载接入

调用 `nativeImageViewer.open()` 时，图片条目的 `download.onInvoke` 会收到 `{ item, src, signal, onProgress }`。将 `signal` 传给下载请求，并通过 `onProgress({ loaded, total })` 上报字节数。文件总大小未知时省略 `total`，查看器显示准备状态和取消按钮。

旧的下载回调仍可使用；要实际停止自定义传输，回调需要响应 `signal`。查看器会忽略已取消操作的迟到进度和结果。下载权限及原图完整性校验仍由提供图片的插件负责。

## 隐私

图片数据保留在当前浏览器配置中。插件只读取 DSH 已经渲染的图片 URL，不上传图片、不调用模型，也不读取供应商凭据。当前 DSH 页面会话内重新打开同一张图片时，区域备注仍会保留；除非其他插件响应用户的明确操作，否则不会写入会话存储。

## 反馈

请通过[问题反馈表单](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml)提供准确的插件版本、DSH 版本、操作系统、图片所在位置（消息或输入框）以及失败的操作。不要提交私人图片、凭据或完整会话日志。敏感安全问题请通过 [GitHub Security Advisories](https://github.com/WSL043/dsh-image-viewer/security/advisories/new) 私下报告。

## 许可证

[English](README.en.md) · [反馈问题](https://github.com/WSL043/dsh-image-viewer/issues/new?template=bug-report.yml) · [功能建议](https://github.com/WSL043/dsh-image-viewer/issues/new?template=feature-request.yml) · [MIT](LICENSE)
