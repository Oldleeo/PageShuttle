# 安装教程

## 系统要求

- Windows 10 或 Windows 11（64 位）；
- Google Chrome 120 或更高版本；
- 首次安装需要开启 Chrome 开发者模式，不需要管理员权限。

## 第一次安装

1. 从 [GitHub Releases](https://github.com/Oldleeo/PageShuttle/releases/latest) 下载 `PageShuttle-版本号-win-x64.zip`。
2. 将压缩包完整解压到普通文件夹，不要直接在压缩软件预览窗口内运行。
3. 双击 `安装 页梭.cmd`。
4. 安装程序会复制 helper 和扩展到 `%LOCALAPPDATA%\Oldlee\ChromeOnlyProxy`，并打开 `chrome://extensions`。
5. 开启右上角“开发者模式”。
6. 点击“加载已解压的扩展程序”，选择安装程序显示的 `extension` 文件夹。
7. 将“页梭”固定到 Chrome 工具栏。

固定扩展 ID：`fmbeehpohhpjacimkghepkiempnbpplg`。

## 升级

从 v0.5.0 开始，在页梭设置中点击“检查更新”，发现新版后点击“立即更新”。页梭会验证签名、暂停自身代理、备份旧版、安装新版并自动重新加载。

如果从 v0.4.0 或更早版本升级到 v0.5.0，需要最后手动运行一次新包中的 `安装 页梭.cmd`；之后即可一键更新。

## 卸载

1. 在页梭中点击“暂停”。
2. 双击发行包中的 `卸载 页梭.cmd`。
3. 在 `chrome://extensions` 中移除页梭。

卸载程序只删除 `%LOCALAPPDATA%\Oldlee\ChromeOnlyProxy` 和当前用户 Native Messaging 注册项，不修改 Windows 系统代理。
