# 更新机制与威胁模型

页梭使用公开 GitHub Releases 作为分发源，但不把“下载成功”视为可信。v0.6.0 起，同一更新清单会分别列出 Windows、Intel Mac 和 Apple Silicon Mac 安装包。

## 验证链

1. helper 只访问固定的官方更新清单地址。
2. 更新包 URL 必须是 HTTPS，主机必须为 `github.com` 或 `*.githubusercontent.com`。
3. 下载限制为最多 300 MB。
4. 对完整 ZIP 计算 SHA-256，并与更新清单比较。
5. 使用编译进 helper 的 RSA-3072 公钥验证 RSA-PSS/SHA-256 签名。
6. 解压前逐项检查规范化路径，拒绝 ZIP Slip 路径穿越。
7. 根据当前操作系统与 CPU 架构选择对应包，并验证扩展版本和 helper、updater、Xray 必需文件。

## 安装与回滚

Windows 更新暂存在 `%LOCALAPPDATA%\Oldlee\ChromeOnlyProxy\updates`；macOS 更新暂存在 `~/Library/Application Support/Oldlee/ChromeOnlyProxy/updates`。helper 退出后，独立更新器把当前 `extension` 和 `helper` 移入备份目录，再移动新目录到固定位置。如果任何步骤失败，会删除不完整的新目录并恢复旧目录。

默认保留最近两个备份。Chrome 扩展存储位于 Chrome 配置中，不在安装目录内，因此节点、收藏和设置不会因文件更新而丢失。

## 发布私钥

私钥仅保存在作者本机或 GitHub Actions 加密 Secret 中，不进入源码和发行包。仓库只包含验证公钥。
