# 安装教程

## 系统要求

- Windows 10/11（x64），或 macOS 13 及以上版本；
- macOS 同时支持 Apple Silicon 与 Intel；
- Google Chrome 120 或更高版本；
- 首次安装需要开启 Chrome 开发者模式，不需要管理员或 root 权限。

固定扩展 ID：`fmbeehpohhpjacimkghepkiempnbpplg`。

## Windows 第一次安装

1. 从 [GitHub Releases](https://github.com/Oldleeo/PageShuttle/releases/latest) 下载 `PageShuttle-版本号-win-x64.zip`。
2. 将压缩包完整解压到普通文件夹，不要直接在压缩软件预览窗口内运行。
3. 双击 `安装 页梭.cmd`。
4. 安装程序会复制 helper 和扩展到 `%LOCALAPPDATA%\Oldlee\ChromeOnlyProxy`，并打开 `chrome://extensions`。
5. 开启右上角“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择安装程序显示的 `extension` 文件夹。
7. 将“页梭”固定到 Chrome 工具栏。

## macOS 第一次安装

1. Apple Silicon（M1/M2/M3/M4）下载 `PageShuttle-版本号-osx-arm64.zip`；Intel Mac 下载 `PageShuttle-版本号-osx-x64.zip`。
2. 完整解压压缩包。
3. 右键点击 `安装 页梭.command`，选择“打开”。如果系统提示无法验证开发者，请到“系统设置 → 隐私与安全性”确认打开，然后重试。
4. 安装程序会把 helper 和扩展复制到 `~/Library/Application Support/Oldlee/ChromeOnlyProxy`，并注册当前用户的 Chrome Native Messaging host。
5. 打开 `chrome://extensions`，开启“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择安装程序显示的 `extension` 文件夹。
7. 将“页梭”固定到 Chrome 工具栏。

也可以在终端中进入解压目录后执行：

```bash
bash "安装 页梭.command"
```

macOS 安装器不修改“网络 → 代理”、VPN、DNS、网络接口或防火墙。

## 升级

页梭每 12 小时检查一次公开 GitHub Release，也可以在设置中手动点击“检查更新”。发现新版本后需要用户确认；helper 会根据当前系统自动选择 `win-x64`、`osx-x64` 或 `osx-arm64` 签名包，验证 SHA-256 与 RSA-PSS 签名后安装，失败时自动回滚。

从 v0.4.0 或更早版本升级，需要最后手动运行一次新包中的安装脚本；之后即可在扩展中一键更新。

## 卸载

### Windows

1. 在页梭中点击“暂停”。
2. 双击发行包中的 `卸载 页梭.cmd`。
3. 在 `chrome://extensions` 中移除页梭。

### macOS

1. 在页梭中点击“暂停”。
2. 右键打开发行包中的 `卸载 页梭.command`，或在终端运行 `bash "卸载 页梭.command"`。
3. 在 `chrome://extensions` 中移除页梭。

卸载程序只删除页梭自己的安装目录和当前用户 Native Messaging 配置，不修改系统代理。
