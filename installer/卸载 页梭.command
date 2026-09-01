#!/bin/bash
set -euo pipefail

NATIVE_HOST_NAME="com.oldlee.chrome_only_proxy"
INSTALL_ROOT="$HOME/Library/Application Support/Oldlee/ChromeOnlyProxy"
EXPECTED_ROOT="$HOME/Library/Application Support/Oldlee/ChromeOnlyProxy"
HOST_MANIFEST_PATH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$NATIVE_HOST_NAME.json"
INSTALLED_HELPER="$INSTALL_ROOT/helper"

if [[ "$INSTALL_ROOT" != "$EXPECTED_ROOT" || -z "$HOME" ]]; then
  echo "卸载目录校验失败，已停止。" >&2
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

pids="$(find_owned_pids)"
if [[ -n "$pids" ]]; then
  while IFS= read -r pid; do /bin/kill -TERM "$pid" 2>/dev/null || true; done <<< "$pids"
  for _ in {1..20}; do
    [[ -z "$(find_owned_pids)" ]] && break
    /bin/sleep 0.2
  done
  pids="$(find_owned_pids)"
  while IFS= read -r pid; do [[ -n "$pid" ]] && /bin/kill -KILL "$pid" 2>/dev/null || true; done <<< "$pids"
fi

if [[ -f "$HOST_MANIFEST_PATH" ]]; then
  /bin/rm -f "$HOST_MANIFEST_PATH"
fi
if [[ -d "$INSTALL_ROOT" ]]; then
  /bin/rm -rf "$INSTALL_ROOT"
fi

echo "页梭本地助手已卸载。"
echo "没有修改 macOS 系统代理。"
echo "请在 chrome://extensions 中手动移除页梭。"
if [[ -t 0 ]]; then
  echo ""
  read -r -p "按回车键关闭……" _
fi
