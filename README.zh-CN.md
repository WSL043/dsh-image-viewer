<div align="center">

# DSH 原生图片查看器

面向 DeepSeek Harness 的简洁、与模型和供应商无关的图片查看器。它只增强 DSH 已经显示的图片，不替换会话、附件或模型流程。

[![CI](https://github.com/WSL043/dsh-native-image-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/WSL043/dsh-native-image-viewer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-native-image-viewer?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-native-image-viewer)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-native-image-viewer?logo=npm&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-native-image-viewer)
[![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-Beta-7c3aed.svg)](#安装)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)

[安装](#安装) · [隐私](#隐私) · [English](README.md)

</div>

> Beta：当前适配最新公开版 DSH。遇到无法识别的新图片结构时会保留 DSH 原生行为，不会猜测接管。

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-native-image-viewer/main/docs/assets/image-viewer-dark.png" width="900" alt="DSH 原生图片查看器的适应窗口、原始大小、缩放和下载操作">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/WSL043/dsh-native-image-viewer/main/docs/assets/image-viewer-note.png" width="900" alt="直接在图片编号附近编辑区域备注">
</p>

## 功能

- 以鼠标位置为中心的滚轮缩放、拖动查看、触控双指缩放和双击原始大小。
- 适应窗口、原始大小、原图下载、键盘切换和多图浏览。
- 一次点击标记一个区域，备注直接显示在图片编号附近并自动获得输入焦点。
- 使用 DSH 设计令牌适配亮色、暗色、响应式布局、焦点约束和减少动态效果设置。
- 提供可选的 `nativeImageViewer` 客户端服务，图片生成插件可以按需增加自己的后续操作。

未安装本插件或插件无法识别更新后的图片界面时，DSH 仍保持原有查看能力。其他插件可以在检测到服务时使用高级查看，但仍应保留自己的基础回退。

## 安装

安装 Beta：

```powershell
irm 'https://github.com/WSL043/dsh-native-image-viewer/releases/download/v0.1.0-beta.2/install.ps1' | iex
```

也可以直接使用 DSH 官方命令：

```sh
dsh plugin --profile web add dsh-native-image-viewer@0.1.0-beta.2
```

保存正在进行的工作后手动重启 DSH。本插件不需要供应商凭据或图片生成账户权限。

## 更新

使用目标版本对应的固定 PowerShell 助手或官方 `add` 命令更新。

## 卸载

```sh
dsh plugin --profile web remove dsh-native-image-viewer
```

卸载后恢复 DSH 内置图片灯箱，不会删除会话、附件、生成图片、供应商插件或凭据。

## 隐私

图片数据保留在当前浏览器配置中。插件只读取 DSH 已经渲染的图片 URL，不上传图片、不调用模型，也不读取供应商凭据。区域备注默认只在当前查看过程中存在；只有其他插件在用户主动操作时才可以使用它们。

## 反馈

请在 [GitHub Issue](https://github.com/WSL043/dsh-native-image-viewer/issues/new) 中提供准确的插件版本、DSH 版本、操作系统、图片所在位置（消息或输入框）以及失败的操作。不要提交私人图片、凭据或完整会话日志。

## 许可证

[English](README.md) · [反馈问题](https://github.com/WSL043/dsh-native-image-viewer/issues/new) · [MIT](LICENSE)
