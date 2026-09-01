#!/bin/bash
set -euo pipefail

PRODUCT_NAME="页梭"
EXTENSION_ID="fmbeehpohhpjacimkghepkiempnbpplg"
NATIVE_HOST_NAME="com.oldlee.chrome_only_proxy"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

if [[ -f "$SCRIPT_DIR/extension/manifest.json" ]]; then
  PACKAGE_ROOT="$SCRIPT_DIR"
else
  PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
fi

SOURCE_EXTENSION="$PACKAGE_ROOT/extension"
SOURCE_HELPER="$PACKAGE_ROOT/helper"
INSTALL_ROOT="$HOME/Library/Application Support/Oldlee/ChromeOnlyProxy"
EXPECTED_ROOT="$HOME/Library/Application Support/Oldlee/ChromeOnlyProxy"
INSTALLED_EXTENSION="$INSTALL_ROOT/extension"
INSTALLED_HELPER="$INSTALL_ROOT/helper"
HOST_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_MANIFEST_PATH="$HOST_MANIFEST_DIR/$NATIVE_HOST_NAME.json"

if [[ "$INSTALL_ROOT" != "$EXPECTED_ROOT" || -z "$HOME" ]]; then
  echo "安装目录校验失败，已停止。" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_EXTENSION/manifest.json" ]]; then
  echo "安装包不完整：缺少 extension/manifest.json" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_HELPER/ChromeProxyHost" ]]; then
  echo "安装包不完整：缺少 helper/ChromeProxyHost" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_HELPER/xray/xray" ]]; then
  echo "安装包不完整：缺少 helper/xray/xray" >&2
  exit 1
fi

find_owned_pids() {
  local expected_helper="$INSTALLED_HELPER/ChromeProxyHost"
  local expected_xray="$INSTALLED_HELPER/xray/xray"
  local candidate command
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    command="$(/bin/ps -p "$candidate" -o command= 2>/dev/null || true)"
    if [[ "$command" == "$expected_helper" || "$command" == "$expected_helper "* ||
          "$command" == "$expected_xray" || "$command" == "$expected_xray "* ]]; then
      echo "$candidate"
    fi
  done < <(/usr/bin/pgrep -f 'ChromeProxyHost|/xray/xray' 2>/dev/null || true)
}

stop_owned_processes() {
  local pids
  pids="$(find_owned_pids)"
  [[ -n "$pids" ]] || return 0
  echo "检测到页梭正在运行，正在停止页梭自己的本地进程……"
  while IFS= read -r pid; do /bin/kill -TERM "$pid" 2>/dev/null || true; done <<< "$pids"
  for _ in {1..20}; do
    [[ -z "$(find_owned_pids)" ]] && return 0
    /bin/sleep 0.2
  done
  pids="$(find_owned_pids)"
  while IFS= read -r pid; do [[ -n "$pid" ]] && /bin/kill -KILL "$pid" 2>/dev/null || true; done <<< "$pids"
}

stop_owned_processes
/bin/mkdir -p "$INSTALL_ROOT" "$HOST_MANIFEST_DIR"

STAGING="$INSTALL_ROOT/.install-$$"
/bin/rm -rf "$STAGING"
/bin/mkdir -p "$STAGING/extension" "$STAGING/helper"
/usr/bin/ditto "$SOURCE_EXTENSION" "$STAGING/extension"
/usr/bin/ditto "$SOURCE_HELPER" "$STAGING/helper"
/bin/chmod 755 "$STAGING/helper/ChromeProxyHost" "$STAGING/helper/PageShuttleUpdater" "$STAGING/helper/xray/xray"
/usr/bin/xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null || true

/bin/rm -rf "$INSTALLED_EXTENSION" "$INSTALLED_HELPER"
/bin/mv "$STAGING/extension" "$INSTALLED_EXTENSION"
/bin/mv "$STAGING/helper" "$INSTALLED_HELPER"
/bin/rmdir "$STAGING"

/bin/cat > "$HOST_MANIFEST_PATH" <<EOF
{
  "name": "$NATIVE_HOST_NAME",
  "description": "$PRODUCT_NAME 本地回环助手",
  "path": "$INSTALLED_HELPER/ChromeProxyHost",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
/bin/chmod 644 "$HOST_MANIFEST_PATH"

echo ""
echo "$PRODUCT_NAME 本地助手已安装。"
echo "本次安装没有修改 macOS 系统代理、VPN、网络接口或防火墙。"
echo ""
echo "请在 Chrome 中完成最后一步："
echo "1. 打开 chrome://extensions"
echo "2. 开启右上角『开发者模式』"
echo "3. 点击『加载已解压的扩展程序』"
echo "4. 选择：$INSTALLED_EXTENSION"
echo ""
echo "固定扩展 ID：$EXTENSION_ID"
echo "作者：老李Oldlee  https://x.com/oldleeoo"

if [[ "${PAGESHUTTLE_NO_LAUNCH:-0}" != "1" ]]; then
  /usr/bin/open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
  /usr/bin/open -R "$INSTALLED_EXTENSION" 2>/dev/null || true
fi
if [[ -t 0 ]]; then
  echo ""
  read -r -p "按回车键关闭……" _
fi
