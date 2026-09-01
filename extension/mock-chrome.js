(function () {
  "use strict";
  if (globalThis.chrome?.runtime?.id) return;
  globalThis.__PAGE_SHUTTLE_MOCK__ = true;
  const listeners = [];
  let state = {
    nodes: [
      { id: "demo-1", name: "🇸🇬 新加坡 · Reality", type: "vless", server: "sg.example.com", port: 443, network: "tcp", security: "reality", requiresHelper: true, supported: true, favoriteGroupId: "group-daily" },
      { id: "demo-2", name: "🇯🇵 日本东京 · WebSocket", type: "vless", server: "jp.example.com", port: 443, network: "ws", security: "tls", requiresHelper: true, supported: true, favoriteGroupId: "group-asia" },
      { id: "demo-3", name: "🇺🇸 美国西部 · Trojan", type: "trojan", server: "us.example.com", port: 443, network: "grpc", security: "tls", requiresHelper: true, supported: true, favoriteGroupId: null },
      { id: "demo-4", name: "Local SOCKS5", type: "socks5", server: "127.0.0.1", port: 1080, network: "tcp", security: "none", requiresHelper: false, supported: true, favoriteGroupId: null }
    ],
    activeNodeId: "demo-1",
    selectedNodeId: "demo-1",
    status: "connected",
    settings: { routingMode: "global", domains: "", protectWebRtc: true, bypassLocal: true, locationMode: "auto", manualLatitude: "", manualLongitude: "", manualAccuracy: "1000", manualLabel: "手动位置", manualCountryCode: "SG", manualTimezone: "Asia/Singapore", manualLocale: "en-SG", matchTimezone: true, matchLanguage: true, fontPrivacyMode: "strict" },
    favoriteGroups: [{ id: "group-daily", name: "日常使用" }, { id: "group-asia", name: "亚洲节点" }],
    exitLocation: { ip: "203.0.113.42", label: "新加坡 新加坡", country: "Singapore", countryCode: "SG", city: "Singapore", latitude: 1.3521, longitude: 103.8198, timezone: "Asia/Singapore" },
    locationError: "",
    locationOverride: { enabled: true, mode: "auto", latitude: 1.3521, longitude: 103.8198, accuracy: 25000, countryCode: "SG", locale: "en-SG", languages: ["en-SG"], timeZone: "Asia/Singapore", timezoneEnabled: true, languageEnabled: true, fontPrivacyMode: "strict", hiddenFonts: ["Microsoft YaHei", "PingFang SC", "MiSans"], reportedFonts: ["Arial", "Times New Roman"], fontFallback: "Arial" },
    updateInfo: { available: true, currentVersion: "0.6.0", version: "0.6.1", releasePage: "https://github.com/Oldleeo/PageShuttle/releases", notes: ["新增安全远程更新", "更新失败自动回滚"], checkedAt: Date.now() },
    updateError: "",
    lastError: ""
  };
  function emit() { listeners.forEach((listener) => listener({ type: "STATE_CHANGED", state })); }
  globalThis.chrome = {
    runtime: {
      id: "",
      getManifest() { return { version: "0.6.0" }; },
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) {
        if (message.type === "GET_STATE") return { ok: true, state };
        if (message.type === "CHECK_IP") return { ok: true, ip: state.exitLocation.ip, location: state.exitLocation };
        if (message.type === "CONNECT" || message.type === "START") state = { ...state, activeNodeId: message.nodeId || state.selectedNodeId, status: "connected" };
        if (message.type === "PAUSE" || message.type === "DISCONNECT") state = { ...state, activeNodeId: null, status: "paused" };
        if (message.type === "SELECT_NODE") state = { ...state, selectedNodeId: message.nodeId };
        if (message.type === "DELETE_NODE") state = { ...state, nodes: state.nodes.filter((node) => node.id !== message.nodeId) };
        if (message.type === "SAVE_SETTINGS") state = { ...state, settings: message.settings };
        if (message.type === "CHECK_UPDATE") return { ok: true, update: state.updateInfo };
        if (message.type === "INSTALL_UPDATE") {
          state = { ...state, status: "paused", activeNodeId: null, updateInfo: { ...state.updateInfo, installing: true } };
          emit();
          return { ok: true, update: { installing: true, version: state.updateInfo.version } };
        }
        if (message.type === "SET_NODE_FAVORITE") state = { ...state, nodes: state.nodes.map((node) => node.id === message.nodeId ? { ...node, favoriteGroupId: message.groupId } : node) };
        if (message.type === "DELETE_FAVORITE_GROUP") state = { ...state, favoriteGroups: state.favoriteGroups.filter((group) => group.id !== message.groupId), nodes: state.nodes.map((node) => node.favoriteGroupId === message.groupId ? { ...node, favoriteGroupId: null } : node) };
        if (message.type === "CREATE_FAVORITE_GROUP") {
          const group = { id: `group-${Date.now()}`, name: message.name };
          state = { ...state, favoriteGroups: [...state.favoriteGroups, group] };
          emit();
          return { ok: true, group, state };
        }
        if (message.type === "ADD_NODES") {
          state = { ...state, nodes: [...state.nodes, ...message.nodes] };
          return { ok: true, result: { added: message.nodes.length, updated: 0, nodes: state.nodes } };
        }
        emit();
        return { ok: true, state };
      }
    }
  };
})();
