import "./lib/state-utils.js";

const NATIVE_HOST = "com.oldlee.chrome_only_proxy";
const GEO_ENDPOINT = "https://ipwho.is/";
const DEFAULT_SETTINGS = {
  routingMode: "global",
  domains: "",
  protectWebRtc: true,
  bypassLocal: true,
  locationMode: "auto",
  manualLatitude: "",
  manualLongitude: "",
  manualAccuracy: "1000",
  manualLabel: "手动位置",
  manualCountryCode: "MY",
  manualTimezone: "Asia/Kuala_Lumpur",
  manualLocale: "ms-MY",
  matchTimezone: false,
  matchLanguage: true,
  settingsSchemaVersion: 2
};
const STATE_KEYS = [
  "nodes", "activeNodeId", "selectedNodeId", "status", "settings", "lastError",
  "favoriteGroups", "exitLocation", "locationError", "locationOverride", "updateInfo", "updateError"
];

let nativePort = null;
let requestSequence = 0;
let currentProxyAuth = null;
let initializationStarted = false;
const pendingNative = new Map();
const closingNativePorts = new WeakSet();

class PageShuttleError extends Error {
  constructor(message, code = "") {
    super(message);
    this.code = code;
  }
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

async function getState() {
  const stored = await storageGet(STATE_KEYS);
  const nodes = Array.isArray(stored.nodes) ? stored.nodes : [];
  const rawSettings = stored.settings || {};
  const settings = PageShuttleState.normalizeSettings(rawSettings, DEFAULT_SETTINGS);
  const selectedNodeId = nodes.some((node) => node.id === stored.selectedNodeId)
    ? stored.selectedNodeId
    : (nodes.some((node) => node.id === stored.activeNodeId) ? stored.activeNodeId : (nodes.find((node) => node.supported)?.id || null));
  return {
    nodes,
    activeNodeId: stored.activeNodeId || null,
    selectedNodeId,
    status: stored.status === "disconnected" ? "paused" : (stored.status || "paused"),
    settings,
    lastError: stored.lastError || "",
    favoriteGroups: PageShuttleState.normalizeGroups(stored.favoriteGroups),
    exitLocation: stored.exitLocation || null,
    locationError: stored.locationError || "",
    locationOverride: stored.locationOverride || { enabled: false },
    updateInfo: stored.updateInfo || null,
    updateError: stored.updateError || ""
  };
}

async function publishState(patch = {}) {
  if (Object.keys(patch).length) await storageSet(patch);
  const state = await getState();
  const connected = state.status === "connected";
  await chrome.action.setBadgeText({ text: connected ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#22C55E" });
  chrome.runtime.sendMessage({ type: "STATE_CHANGED", state }).catch(() => {});
  return state;
}

function nativeError(reason) {
  const missing = /not found|not registered|native messaging host.*(?:missing|specified)|未找到|未注册/i.test(reason || "");
  return new PageShuttleError(
    missing ? "尚未安装页梭本地助手，请运行安装包中对应系统的「安装 页梭」脚本" : (reason || "本地助手已断开"),
    missing ? "HELPER_NOT_INSTALLED" : "HELPER_ERROR"
  );
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort = port;
  port.onMessage.addListener((message) => {
    const pending = pendingNative.get(message.id);
    if (!pending) return;
    pendingNative.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message);
    else pending.reject(new PageShuttleError(message.error || "本地助手返回了错误", "HELPER_ERROR"));
  });
  port.onDisconnect.addListener(async () => {
    const reason = chrome.runtime.lastError?.message || "本地助手已断开";
    if (nativePort === port) nativePort = null;
    for (const pending of pendingNative.values()) {
      clearTimeout(pending.timeout);
      pending.reject(nativeError(reason));
    }
    pendingNative.clear();
    if (!closingNativePorts.has(port)) {
      const state = await getState();
      const active = state.nodes.find((node) => node.id === state.activeNodeId);
      if (active?.requiresHelper && state.status === "connected") {
        await clearChromeProxy();
        await disableLocationOverride();
        await publishState({ status: "error", activeNodeId: null, lastError: `本地助手连接中断：${reason}` });
      }
    }
  });
  return port;
}

function nativeRequest(action, payload = {}, timeoutMs = 12000) {
  const port = connectNativeHost();
  const id = `req-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingNative.delete(id);
      reject(new PageShuttleError("本地助手响应超时", "HELPER_TIMEOUT"));
    }, timeoutMs);
    pendingNative.set(id, { resolve, reject, timeout });
    port.postMessage({ id, action, ...payload });
  });
}

async function stopNative() {
  if (!nativePort) return;
  try { await nativeRequest("stop", {}, 4000); } catch {}
  const port = nativePort;
  closingNativePorts.add(port);
  port.disconnect();
  if (nativePort === port) nativePort = null;
}

function proxyDescriptor(node, localPort) {
  if (localPort) return { scheme: "socks5", host: "127.0.0.1", port: Number(localPort) };
  return { scheme: node.type, host: node.server, port: Number(node.port) };
}

function makePacScript(proxy, domains, bypassLocal) {
  const schemeNames = { http: "PROXY", https: "HTTPS", socks4: "SOCKS", socks5: "SOCKS5" };
  const target = `${schemeNames[proxy.scheme] || "PROXY"} ${proxy.host}:${proxy.port}`;
  const rules = domains.split(/[\r\n,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const localClause = bypassLocal
    ? 'if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || shExpMatch(host, "10.*") || shExpMatch(host, "192.168.*") || shExpMatch(host, "172.1[6-9].*") || shExpMatch(host, "172.2?.*") || shExpMatch(host, "172.3[0-1].*")) return "DIRECT";'
    : "";
  return `function FindProxyForURL(url, host) {
    host = host.toLowerCase();
    ${localClause}
    var proxyTarget = ${JSON.stringify(target)};
    if (host === "ipwho.is" || host === "api64.ipify.org") return proxyTarget;
    var rules = ${JSON.stringify(rules)};
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i].replace(/^\\*\\./, "");
      if (host === rule || dnsDomainIs(host, "." + rule) || shExpMatch(host, rules[i])) return proxyTarget;
    }
    return "DIRECT";
  }`;
}

async function applyChromeProxy(node, localPort, settings) {
  const control = await chrome.proxy.settings.get({ incognito: false });
  if (!["controllable_by_this_extension", "controlled_by_this_extension"].includes(control.levelOfControl)) {
    throw new PageShuttleError("当前 Chrome 代理被管理策略或另一个扩展控制", "PROXY_NOT_CONTROLLABLE");
  }
  const proxy = proxyDescriptor(node, localPort);
  let value;
  if (settings.routingMode === "domains") {
    if (!settings.domains.trim()) throw new PageShuttleError("请先填写需要代理的网站域名", "DOMAINS_REQUIRED");
    value = { mode: "pac_script", pacScript: { data: makePacScript(proxy, settings.domains, settings.bypassLocal), mandatory: true } };
  } else {
    value = {
      mode: "fixed_servers",
      rules: {
        singleProxy: proxy,
        bypassList: settings.bypassLocal ? ["<local>", "localhost", "127.0.0.1", "[::1]"] : []
      }
    };
  }
  await chrome.proxy.settings.set({ value, scope: "regular_only" });
  const effective = await chrome.proxy.settings.get({ incognito: false });
  if (effective.levelOfControl !== "controlled_by_this_extension") {
    throw new PageShuttleError("Chrome 没有接受该代理设置，请禁用其他代理扩展后重试", "PROXY_NOT_APPLIED");
  }
  currentProxyAuth = node.username ? { username: node.username, password: node.password || "" } : null;
  await chrome.storage.session.set({ currentProxyAuth });
  if (settings.protectWebRtc) {
    try { await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: "disable_non_proxied_udp", scope: "regular_only" }); } catch {}
  }
}

async function clearChromeProxy() {
  try { await chrome.proxy.settings.clear({ scope: "regular_only" }); } catch {}
  try { await chrome.privacy.network.webRTCIPHandlingPolicy.clear({ scope: "regular_only" }); } catch {}
  currentProxyAuth = null;
  await chrome.storage.session.remove("currentProxyAuth");
}

async function disableLocationOverride() {
  await storageSet({ locationOverride: { enabled: false } });
}

async function fetchExitLocation() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fields = "success,message,ip,country,country_code,region,city,latitude,longitude,timezone";
    const response = await fetch(`${GEO_ENDPOINT}?lang=zh&fields=${encodeURIComponent(fields)}&t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`IP 定位失败（${response.status}）`);
    return PageShuttleState.normalizeGeoResponse(await response.json());
  } catch (error) {
    if (error.name === "AbortError") throw new Error("IP 定位超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function syncLocation(state, detectAuto = false) {
  if (state.status !== "connected" || state.settings.locationMode === "off") {
    return publishState({ locationOverride: { enabled: false }, locationError: "" });
  }
  if (state.settings.locationMode === "manual") {
    const manual = PageShuttleState.buildEnvironmentProfile(null, state.settings, "manual");
    return publishState({
      locationOverride: manual,
      locationError: ""
    });
  }
  try {
    const location = detectAuto || !state.exitLocation ? await fetchExitLocation() : state.exitLocation;
    const environment = PageShuttleState.buildEnvironmentProfile(location, state.settings, "auto");
    return publishState({
      exitLocation: location,
      locationOverride: environment,
      locationError: ""
    });
  } catch (error) {
    return publishState({ locationOverride: { enabled: false }, locationError: error.message });
  }
}

async function connectNode(nodeId) {
  const state = await getState();
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new PageShuttleError("请先选择一个节点", "NODE_REQUIRED");
  if (!node.supported) throw new PageShuttleError(node.unsupportedReason || "该节点暂不支持", "NODE_UNSUPPORTED");
  await publishState({ status: "connecting", selectedNodeId: node.id, activeNodeId: null, lastError: "", locationError: "" });
  let localPort = null;
  try {
    await clearChromeProxy();
    if (node.requiresHelper) {
      await stopNative();
      const response = await nativeRequest("start", { node }, 20000);
      localPort = response.port;
    } else {
      await stopNative();
    }
    await applyChromeProxy(node, localPort, state.settings);
    const connected = await publishState({ status: "connected", activeNodeId: node.id, selectedNodeId: node.id, lastError: "" });
    return syncLocation(connected, connected.settings.locationMode === "auto");
  } catch (error) {
    await clearChromeProxy();
    await stopNative();
    await disableLocationOverride();
    if (error.code === "HELPER_NOT_INSTALLED") chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") }).catch(() => {});
    await publishState({ status: "error", activeNodeId: null, selectedNodeId: node.id, lastError: error.message });
    throw error;
  }
}

async function startSelected() {
  const state = await getState();
  const selected = state.nodes.find((node) => node.id === state.selectedNodeId && node.supported) || state.nodes.find((node) => node.supported);
  if (!selected) throw new PageShuttleError(state.nodes.length ? "没有可用的节点" : "请先导入代理节点", "NODE_REQUIRED");
  return connectNode(selected.id);
}

async function pauseProxy() {
  await clearChromeProxy();
  await stopNative();
  await disableLocationOverride();
  return publishState({ status: "paused", activeNodeId: null, lastError: "" });
}

function nodeKey(node) {
  return [node.type, node.server, node.port, node.uuid || node.username || "", node.password || "", node.network || ""].join("|");
}

async function addNodes(incoming) {
  const state = await getState();
  const map = new Map(state.nodes.map((node) => [nodeKey(node), node]));
  let added = 0;
  let updated = 0;
  for (const node of incoming) {
    const key = nodeKey(node);
    const old = map.get(key);
    if (old) {
      map.set(key, { ...old, ...node, id: old.id, favoriteGroupId: old.favoriteGroupId || null });
      updated++;
    } else {
      map.set(key, { ...node, favoriteGroupId: node.favoriteGroupId || null });
      added++;
    }
  }
  const nodes = [...map.values()];
  const selectedNodeId = state.selectedNodeId || nodes.find((node) => node.supported)?.id || null;
  await storageSet({ nodes, selectedNodeId });
  return { added, updated, nodes };
}

async function deleteNode(nodeId) {
  const state = await getState();
  if (state.activeNodeId === nodeId) await pauseProxy();
  const nodes = state.nodes.filter((node) => node.id !== nodeId);
  const selectedNodeId = state.selectedNodeId === nodeId ? (nodes.find((node) => node.supported)?.id || null) : state.selectedNodeId;
  await storageSet({ nodes, selectedNodeId });
  return getState();
}

function newGroupId() {
  return `group-${Date.now()}-${crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
}

async function createFavoriteGroup(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new PageShuttleError("请输入分组名称", "GROUP_NAME_REQUIRED");
  if (cleanName.length > 30) throw new PageShuttleError("分组名称不能超过 30 个字符", "GROUP_NAME_TOO_LONG");
  const state = await getState();
  if (state.favoriteGroups.some((group) => group.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    throw new PageShuttleError("已经存在同名分组", "GROUP_EXISTS");
  }
  const group = { id: newGroupId(), name: cleanName };
  await storageSet({ favoriteGroups: [...state.favoriteGroups, group] });
  return { group, state: await getState() };
}

async function deleteFavoriteGroup(groupId) {
  const state = await getState();
  const result = PageShuttleState.removeFavoriteGroup(state.nodes, state.favoriteGroups, groupId);
  await storageSet({ nodes: result.nodes, favoriteGroups: result.groups });
  return getState();
}

async function setNodeFavorite(nodeId, groupId) {
  const state = await getState();
  if (!state.nodes.some((node) => node.id === nodeId)) throw new PageShuttleError("节点不存在", "NODE_NOT_FOUND");
  if (groupId && !state.favoriteGroups.some((group) => group.id === groupId)) throw new PageShuttleError("收藏分组不存在", "GROUP_NOT_FOUND");
  await storageSet({ nodes: PageShuttleState.setNodeFavorite(state.nodes, nodeId, groupId || null) });
  return getState();
}

function proxySettingsChanged(before, after) {
  return ["routingMode", "domains", "protectWebRtc", "bypassLocal"].some((key) => before[key] !== after[key]);
}

async function saveSettings(incoming) {
  const state = await getState();
  const settings = PageShuttleState.normalizeSettings({ ...(incoming || {}), settingsSchemaVersion: 2 }, DEFAULT_SETTINGS);
  if (!["auto", "manual", "off"].includes(settings.locationMode)) settings.locationMode = "auto";
  if (settings.locationMode === "manual") PageShuttleState.buildEnvironmentProfile(null, settings, "manual");
  await storageSet({ settings });
  if (state.activeNodeId && proxySettingsChanged(state.settings, settings)) return connectNode(state.activeNodeId);
  return syncLocation(await getState(), state.status === "connected" && settings.locationMode === "auto" && state.settings.locationMode !== "auto");
}

async function checkForUpdates({ silent = false } = {}) {
  try {
    const result = await nativeRequest("check_update", {}, 35000);
    const updateInfo = {
      available: result.available === true,
      currentVersion: result.currentVersion || chrome.runtime.getManifest().version,
      ...(result.update || {}),
      checkedAt: Date.now()
    };
    await publishState({ updateInfo, updateError: "" });
    return updateInfo;
  } catch (error) {
    await publishState({ updateError: error.message });
    if (!silent) throw error;
    return null;
  }
}

async function installAvailableUpdate() {
  const state = await getState();
  if (!state.updateInfo?.available) await checkForUpdates();
  await clearChromeProxy();
  await stopNative();
  await disableLocationOverride();
  await publishState({ status: "paused", activeNodeId: null, lastError: "", updateError: "" });
  const result = await nativeRequest("install_update", {}, 120000);
  await publishState({
    updateInfo: { ...(await getState()).updateInfo, installing: true, version: result.version },
    updateError: ""
  });
  setTimeout(() => chrome.runtime.reload(), 8000);
  return result;
}

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (details.isProxy && currentProxyAuth?.username) callback({ authCredentials: currentProxyAuth });
    else callback({});
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "GET_STATE": return { ok: true, state: await getState() };
      case "ADD_NODES": return { ok: true, result: await addNodes(message.nodes || []) };
      case "CONNECT": return { ok: true, state: await connectNode(message.nodeId) };
      case "START": return { ok: true, state: await startSelected() };
      case "DISCONNECT":
      case "PAUSE": return { ok: true, state: await pauseProxy() };
      case "SELECT_NODE": {
        const state = await getState();
        if (!state.nodes.some((node) => node.id === message.nodeId)) throw new PageShuttleError("节点不存在", "NODE_NOT_FOUND");
        return { ok: true, state: await publishState({ selectedNodeId: message.nodeId }) };
      }
      case "DELETE_NODE": return { ok: true, state: await deleteNode(message.nodeId) };
      case "CREATE_FAVORITE_GROUP": return { ok: true, ...(await createFavoriteGroup(message.name)) };
      case "DELETE_FAVORITE_GROUP": return { ok: true, state: await deleteFavoriteGroup(message.groupId) };
      case "SET_NODE_FAVORITE": return { ok: true, state: await setNodeFavorite(message.nodeId, message.groupId) };
      case "SAVE_SETTINGS": return { ok: true, state: await saveSettings(message.settings) };
      case "CHECK_UPDATE": return { ok: true, update: await checkForUpdates() };
      case "INSTALL_UPDATE": return { ok: true, update: await installAvailableUpdate() };
      case "CHECK_IP": {
        const location = await fetchExitLocation();
        const state = await getState();
        if (state.status === "connected" && state.settings.locationMode === "auto") {
          const environment = PageShuttleState.buildEnvironmentProfile(location, state.settings, "auto");
          await publishState({ exitLocation: location, locationOverride: environment, locationError: "" });
        }
        return { ok: true, ip: location.ip, location };
      }
      case "HELPER_STATUS": return { ok: true, helper: await nativeRequest("status", {}, 5000) };
      case "OPEN_SETUP": {
        await chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
        return { ok: true };
      }
      default: throw new PageShuttleError("未知操作", "UNKNOWN_ACTION");
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "" }));
  return true;
});

async function initialize() {
  if (initializationStarted) return;
  initializationStarted = true;
  const session = await chrome.storage.session.get("currentProxyAuth");
  currentProxyAuth = session.currentProxyAuth || null;
  let state = await getState();
  await storageSet({ favoriteGroups: state.favoriteGroups, selectedNodeId: state.selectedNodeId, settings: state.settings });
  if (state.status === "connected" && state.activeNodeId) {
    connectNode(state.activeNodeId).catch(() => {});
  } else {
    await clearChromeProxy();
    await disableLocationOverride();
    state = await publishState({ status: "paused", activeNodeId: null });
  }
  await chrome.action.setBadgeText({ text: state.status === "connected" ? "ON" : "" });
}

chrome.runtime.onInstalled.addListener(() => initialize().catch(() => {}));
chrome.runtime.onStartup.addListener(() => initialize().catch(() => {}));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "page-shuttle-update-check") checkForUpdates({ silent: true }).catch(() => {});
});
chrome.alarms.create("page-shuttle-update-check", { delayInMinutes: 5, periodInMinutes: 720 });
initialize().catch(() => {});
