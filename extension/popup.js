"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let state = null;
let activeImportTab = "text";
let favoriteNodeId = null;
let searchQuery = "";
let groupFilter = "all";
let toastTimer = null;

async function message(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) {
    const error = new Error(response?.error || "操作失败");
    error.code = response?.code || "";
    throw error;
  }
  return response;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(text, isError = false) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function selectedNode() {
  return state.nodes.find((node) => node.id === state.selectedNodeId) || null;
}

function statusCopy() {
  const active = state.nodes.find((node) => node.id === state.activeNodeId);
  const selected = selectedNode();
  if (state.status === "connected") return ["已启动", active?.name || "代理正在运行"];
  if (state.status === "connecting") return ["正在启动", selected?.name || "正在连接本地助手"];
  if (state.status === "error") return ["启动失败", state.lastError || "请检查节点和本地助手"];
  return ["已暂停", selected ? `已选择：${selected.name}` : "网页正在使用原网络"];
}

function nodeMeta(node) {
  const network = node.network && node.network !== "tcp" ? ` · ${node.network.toUpperCase()}` : "";
  const security = node.security && node.security !== "none" ? ` · ${node.security.toUpperCase()}` : "";
  return `${node.server}:${node.port}${network}${security}`;
}

function renderGroupFilter() {
  const validFilter = groupFilter === "all" || groupFilter === "favorites" || state.favoriteGroups.some((group) => group.id === groupFilter);
  if (!validFilter) groupFilter = "all";
  $("#groupFilter").innerHTML = [
    '<option value="all">全部节点</option>',
    '<option value="favorites">全部收藏</option>',
    ...state.favoriteGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
  ].join("");
  $("#groupFilter").value = groupFilter;
}

function renderNodes() {
  const list = $("#nodeList");
  const groupMap = new Map(state.favoriteGroups.map((group) => [group.id, group.name]));
  const nodes = PageShuttleState.filterNodes(state.nodes, state.favoriteGroups, searchQuery, groupFilter);
  $("#nodeCount").textContent = nodes.length === state.nodes.length ? `${state.nodes.length} 个` : `${nodes.length}/${state.nodes.length} 个`;
  $("#emptyState").hidden = nodes.length > 0;
  list.hidden = nodes.length === 0;
  $("#emptyImportButton").hidden = state.nodes.length > 0;
  $("#emptyTitle").textContent = state.nodes.length ? "没有匹配的节点" : "还没有代理节点";
  $("#emptyDescription").textContent = state.nodes.length ? "请更换搜索词或收藏分组" : "导入 Clash YAML 或粘贴 VLESS 链接";
  list.innerHTML = nodes.map((node) => {
    const active = node.id === state.activeNodeId && state.status === "connected";
    const selected = node.id === state.selectedNodeId;
    const unsupported = !node.supported;
    const groupName = groupMap.get(node.favoriteGroupId);
    return `<article class="node-card${active ? " active" : ""}${selected ? " selected" : ""}${unsupported ? " unsupported" : ""}" data-id="${escapeHtml(node.id)}">
      <div class="node-main" title="${escapeHtml(node.unsupportedReason || node.name)}">
        <div class="node-title-row"><span class="protocol">${escapeHtml(node.type.toUpperCase())}</span><span class="node-title">${escapeHtml(node.name)}</span>${groupName ? `<span class="favorite-tag">${escapeHtml(groupName)}</span>` : ""}</div>
        <div class="node-meta">${escapeHtml(nodeMeta(node))}</div>
      </div>
      <div class="node-actions">
        <button class="connect-button" ${unsupported ? "disabled" : ""}>${active ? "暂停" : "使用"}</button>
        <button class="favorite-button${groupName ? " on" : ""}" title="收藏" aria-label="收藏"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg></button>
        <button class="delete-button" title="删除" aria-label="删除"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg></button>
      </div>
    </article>`;
  }).join("");
  $$(".node-card").forEach((card) => {
    const nodeId = card.dataset.id;
    card.querySelector(".node-main").addEventListener("click", () => selectNode(nodeId));
    card.querySelector(".connect-button").addEventListener("click", () => useNode(nodeId));
    card.querySelector(".favorite-button").addEventListener("click", () => openFavorite(nodeId));
    card.querySelector(".delete-button").addEventListener("click", () => removeNode(nodeId));
  });
}

function locationCopy() {
  if (state.settings.locationMode === "off") return "未修改";
  if (state.settings.locationMode === "manual") {
    const parts = [state.settings.manualCountryCode, state.settings.manualTimezone].filter(Boolean);
    return parts.join(" · ") || state.settings.manualLabel || "手动环境";
  }
  if (state.locationError && state.status === "connected") return "环境同步失败";
  if (state.status === "connected" && state.locationOverride?.enabled) {
    return [state.locationOverride.countryCode, state.locationOverride.timeZone].filter(Boolean).join(" · ") || state.exitLocation?.label || "已跟随 IP";
  }
  return "启动后跟随 IP";
}

function renderSettings() {
  $("#routingMode").value = state.settings.routingMode;
  $("#domains").value = state.settings.domains;
  $("#protectWebRtc").checked = state.settings.protectWebRtc;
  $("#bypassLocal").checked = state.settings.bypassLocal;
  $("#domainsField").hidden = state.settings.routingMode !== "domains";
  $("#locationMode").value = state.settings.locationMode;
  $("#manualLatitude").value = state.settings.manualLatitude ?? "";
  $("#manualLongitude").value = state.settings.manualLongitude ?? "";
  $("#manualAccuracy").value = state.settings.manualAccuracy ?? "1000";
  $("#manualLabel").value = state.settings.manualLabel ?? "";
  $("#manualCountryCode").value = state.settings.manualCountryCode ?? "";
  $("#manualTimezone").value = state.settings.manualTimezone ?? "";
  $("#manualLocale").value = state.settings.manualLocale ?? "";
  $("#matchTimezone").checked = state.settings.matchTimezone !== false;
  $("#matchLanguage").checked = state.settings.matchLanguage !== false;
  $("#fontPrivacyMode").value = state.settings.fontPrivacyMode || "strict";
  $("#manualLocationFields").hidden = state.settings.locationMode !== "manual";
  if (state.settings.locationMode === "auto" && state.exitLocation) {
    const environment = state.locationOverride || {};
    const parts = [
      state.exitLocation.label,
      `${state.exitLocation.latitude.toFixed(4)}, ${state.exitLocation.longitude.toFixed(4)}`,
      environment.timezoneEnabled ? environment.timeZone : "不修改时间",
      environment.languageEnabled ? environment.locale : "不修改语言"
    ].filter(Boolean);
    $("#locationDetail").textContent = parts.join(" · ");
  } else if (state.locationError) {
    $("#locationDetail").textContent = state.locationError;
  } else if (state.settings.locationMode === "manual") {
    $("#locationDetail").textContent = "手动环境会同时用于定位、网页时区、语言识别和字体指纹配置。";
  } else if (state.settings.locationMode === "off") {
    $("#locationDetail").textContent = "代理仍可使用，但网页读取到原始定位、时区、语言和字体环境。";
  } else {
    $("#locationDetail").textContent = "启动后按出口 IP 自动同步；IP 定位为城市级估算，可切换手动模式修正。";
  }
  renderUpdate();
}

function renderUpdate() {
  const current = chrome.runtime.getManifest?.().version || "0.6.0";
  const update = state.updateInfo;
  $("#currentVersion").textContent = `当前 v${current}`;
  $("#installUpdateButton").hidden = !update?.available;
  $("#updateNotes").hidden = !update?.available || !Array.isArray(update.notes) || update.notes.length === 0;
  $("#updateNotes").innerHTML = update?.available && Array.isArray(update.notes)
    ? update.notes.slice(0, 5).map((note) => `<li>${escapeHtml(note)}</li>`).join("")
    : "";
  if (update?.releasePage) $("#releaseLink").href = update.releasePage;
  if (update?.installing) {
    $("#updateTitle").textContent = `正在安装 v${update.version || "新版"}`;
    $("#updateDescription").textContent = "签名已验证，完成后扩展会自动重新加载";
    $("#checkUpdateButton").disabled = true;
    $("#installUpdateButton").disabled = true;
  } else if (update?.available) {
    $("#updateTitle").textContent = `发现新版本 v${update.version}`;
    $("#updateDescription").textContent = "更新前会暂停页梭，失败时自动恢复旧版本";
    $("#checkUpdateButton").disabled = false;
    $("#installUpdateButton").disabled = false;
  } else if (state.updateError) {
    $("#updateTitle").textContent = "暂时无法检查更新";
    $("#updateDescription").textContent = state.updateError;
    $("#checkUpdateButton").disabled = false;
  } else if (update?.checkedAt) {
    $("#updateTitle").textContent = "当前已经是最新版本";
    $("#updateDescription").textContent = `最近检查：${new Date(update.checkedAt).toLocaleString()}`;
    $("#checkUpdateButton").disabled = false;
  } else {
    $("#updateTitle").textContent = "检查页梭新版本";
    $("#updateDescription").textContent = "通过 GitHub Releases 获取签名发行包";
    $("#checkUpdateButton").disabled = false;
  }
}

function render() {
  if (!state) return;
  const [title, subtitle] = statusCopy();
  $("#connectionCard").className = `connection-card ${state.status}`;
  $("#statusTitle").textContent = title;
  $("#statusSubtitle").textContent = subtitle;
  $("#powerButton span").textContent = state.status === "connected" ? "暂停" : (state.status === "connecting" ? "启动中" : "启动");
  $("#powerButton").disabled = state.status === "connecting";
  $("#ipButton b").textContent = state.status === "connected" && state.exitLocation?.ip ? state.exitLocation.ip : "点击检测";
  $("#locationSummary").textContent = locationCopy();
  renderSettings();
  renderGroupFilter();
  renderNodes();
}

async function loadState() {
  state = (await message({ type: "GET_STATE" })).state;
  render();
}

async function selectNode(nodeId) {
  try {
    state = (await message({ type: "SELECT_NODE", nodeId })).state;
    render();
  } catch (error) { showToast(error.message, true); }
}

async function useNode(nodeId) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node?.supported) return;
  try {
    if (state.activeNodeId === nodeId && state.status === "connected") {
      state = (await message({ type: "PAUSE" })).state;
      showToast("已暂停，Chrome 恢复原网络");
    } else {
      state.status = "connecting";
      state.selectedNodeId = nodeId;
      render();
      state = (await message({ type: "CONNECT", nodeId })).state;
      showToast(`已启动 ${node.name}`);
    }
  } catch (error) {
    await loadState();
    showToast(error.message, true);
  }
  render();
}

async function togglePower() {
  const power = $("#powerButton");
  power.disabled = true;
  try {
    if (state.status === "connected") {
      state = (await message({ type: "PAUSE" })).state;
      showToast("已暂停，Chrome 恢复原网络");
    } else {
      state.status = "connecting";
      render();
      state = (await message({ type: "START" })).state;
      showToast("页梭已启动");
    }
  } catch (error) {
    await loadState();
    showToast(error.message, true);
  } finally {
    power.disabled = false;
    render();
  }
}

async function removeNode(nodeId) {
  try {
    state = (await message({ type: "DELETE_NODE", nodeId })).state;
    render();
    showToast("节点已删除");
  } catch (error) { showToast(error.message, true); }
}

function fillFavoriteGroups(selectedGroupId = "") {
  const select = $("#favoriteGroupSelect");
  select.innerHTML = state.favoriteGroups.length
    ? state.favoriteGroups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join("")
    : '<option value="">请先新建收藏分组</option>';
  if (selectedGroupId && state.favoriteGroups.some((group) => group.id === selectedGroupId)) select.value = selectedGroupId;
}

function openFavorite(nodeId) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  favoriteNodeId = nodeId;
  $("#favoriteNodeName").textContent = node.name;
  $("#quickGroupName").value = "";
  fillFavoriteGroups(node.favoriteGroupId);
  $("#removeFavoriteButton").hidden = !node.favoriteGroupId;
  $("#favoriteDialog").showModal();
}

async function createGroup(name, selectForFavorite = false) {
  const result = await message({ type: "CREATE_FAVORITE_GROUP", name });
  state = result.state;
  if (selectForFavorite) fillFavoriteGroups(result.group.id);
  renderGroupsDialog();
  renderGroupFilter();
  return result.group;
}

async function quickCreateGroup() {
  try {
    const name = $("#quickGroupName").value.trim();
    await createGroup(name, true);
    $("#quickGroupName").value = "";
    showToast("收藏分组已新建");
  } catch (error) { showToast(error.message, true); }
}

async function saveFavorite() {
  const groupId = $("#favoriteGroupSelect").value;
  if (!groupId) return showToast("请先新建收藏分组", true);
  try {
    state = (await message({ type: "SET_NODE_FAVORITE", nodeId: favoriteNodeId, groupId })).state;
    $("#favoriteDialog").close();
    render();
    showToast("已收藏到分组");
  } catch (error) { showToast(error.message, true); }
}

async function removeFavorite() {
  try {
    state = (await message({ type: "SET_NODE_FAVORITE", nodeId: favoriteNodeId, groupId: null })).state;
    $("#favoriteDialog").close();
    render();
    showToast("已取消收藏");
  } catch (error) { showToast(error.message, true); }
}

function renderGroupsDialog() {
  if (!state) return;
  const list = $("#groupsList");
  if (!state.favoriteGroups.length) {
    list.innerHTML = '<div class="groups-empty">还没有收藏分组</div>';
    return;
  }
  list.innerHTML = state.favoriteGroups.map((group) => {
    const count = state.nodes.filter((node) => node.favoriteGroupId === group.id).length;
    return `<div class="group-row" data-id="${escapeHtml(group.id)}"><div><span>${escapeHtml(group.name)}</span><small>${count} 个节点</small></div><button type="button">删除</button></div>`;
  }).join("");
  $$(".group-row button").forEach((button) => button.addEventListener("click", () => deleteGroup(button.closest(".group-row").dataset.id)));
}

function openGroups() {
  $("#newGroupName").value = "";
  renderGroupsDialog();
  $("#groupsDialog").showModal();
}

async function createGroupFromManager() {
  try {
    await createGroup($("#newGroupName").value.trim());
    $("#newGroupName").value = "";
    render();
    showToast("分组已新建");
  } catch (error) { showToast(error.message, true); }
}

async function deleteGroup(groupId) {
  const group = state.favoriteGroups.find((item) => item.id === groupId);
  if (!group || !confirm(`删除收藏分组「${group.name}」？节点本身不会被删除。`)) return;
  try {
    state = (await message({ type: "DELETE_FAVORITE_GROUP", groupId })).state;
    renderGroupsDialog();
    render();
    showToast("分组已删除");
  } catch (error) { showToast(error.message, true); }
}

function openImport() {
  $("#importError").hidden = true;
  $("#importDialog").showModal();
}

function selectImportTab(tab) {
  activeImportTab = tab;
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
}

async function readImportContent() {
  if (activeImportTab === "text") return $("#importText").value;
  if (activeImportTab === "file") {
    const file = $("#configFile").files[0];
    if (!file) throw new Error("请先选择配置文件");
    if (file.size > 5 * 1024 * 1024) throw new Error("配置文件不能超过 5 MB");
    return file.text();
  }
  const url = $("#subscriptionUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("请输入有效的 HTTP/HTTPS 订阅地址");
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`订阅下载失败（${response.status}）`);
  return response.text();
}

async function importNodes() {
  const errorBox = $("#importError");
  const button = $("#confirmImportButton");
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = "正在解析…";
  try {
    const content = await readImportContent();
    if (content.length > 5 * 1024 * 1024) throw new Error("导入内容不能超过 5 MB");
    const result = ProxyImporter.parseText(content);
    if (!result.nodes.length) throw new Error(result.errors[0] || "没有找到可导入的节点");
    const added = await message({ type: "ADD_NODES", nodes: result.nodes });
    $("#importDialog").close();
    await loadState();
    const skipped = result.errors.length;
    showToast(`已导入 ${added.result.added} 个，更新 ${added.result.updated} 个${skipped ? `，跳过 ${skipped} 个` : ""}`);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "开始导入";
  }
}

async function saveSettings() {
  const settings = {
    routingMode: $("#routingMode").value,
    domains: $("#domains").value.trim(),
    protectWebRtc: $("#protectWebRtc").checked,
    bypassLocal: $("#bypassLocal").checked,
    locationMode: $("#locationMode").value,
    manualLatitude: $("#manualLatitude").value.trim(),
    manualLongitude: $("#manualLongitude").value.trim(),
    manualAccuracy: $("#manualAccuracy").value.trim(),
    manualLabel: $("#manualLabel").value.trim(),
    manualCountryCode: $("#manualCountryCode").value.trim().toUpperCase(),
    manualTimezone: $("#manualTimezone").value.trim(),
    manualLocale: $("#manualLocale").value.trim(),
    matchTimezone: $("#matchTimezone").checked,
    matchLanguage: $("#matchLanguage").checked,
    fontPrivacyMode: $("#fontPrivacyMode").value
  };
  try {
    state = (await message({ type: "SAVE_SETTINGS", settings })).state;
    render();
    showToast("设置已保存");
  } catch (error) { showToast(error.message, true); }
}

async function checkIp() {
  const button = $("#ipButton b");
  button.textContent = "检测中…";
  try {
    const result = await message({ type: "CHECK_IP" });
    button.textContent = result.ip;
    showToast(result.location?.label ? `出口位置：${result.location.label}` : `出口 IP：${result.ip}`);
  } catch (error) {
    button.textContent = "检测失败";
    showToast(error.message, true);
  }
}

async function checkUpdate() {
  const button = $("#checkUpdateButton");
  button.disabled = true;
  button.textContent = "检查中…";
  try {
    const result = await message({ type: "CHECK_UPDATE" });
    state.updateInfo = result.update;
    state.updateError = "";
    renderUpdate();
    showToast(result.update.available ? `发现新版本 v${result.update.version}` : "当前已经是最新版本");
  } catch (error) {
    await loadState();
    showToast(error.message, true);
  } finally {
    button.textContent = "检查更新";
    button.disabled = false;
  }
}

async function installUpdate() {
  const version = state.updateInfo?.version || "新版";
  if (!confirm(`安装页梭 v${version}？更新期间会暂停当前代理，失败时自动回滚。`)) return;
  $("#installUpdateButton").disabled = true;
  try {
    const result = await message({ type: "INSTALL_UPDATE" });
    state.updateInfo = { ...state.updateInfo, installing: true, version: result.update.version };
    renderUpdate();
    showToast("更新已验证，约 8 秒后自动重新加载");
  } catch (error) {
    await loadState();
    showToast(error.message, true);
  }
}

$("#settingsButton").addEventListener("click", () => { $("#settingsPanel").hidden = !$("#settingsPanel").hidden; });
$("#routingMode").addEventListener("change", (event) => { $("#domainsField").hidden = event.target.value !== "domains"; });
$("#locationMode").addEventListener("change", (event) => { $("#manualLocationFields").hidden = event.target.value !== "manual"; });
$("#saveSettingsButton").addEventListener("click", saveSettings);
$("#checkUpdateButton").addEventListener("click", checkUpdate);
$("#installUpdateButton").addEventListener("click", installUpdate);
$("#powerButton").addEventListener("click", togglePower);
$("#importButton").addEventListener("click", openImport);
$("#emptyImportButton").addEventListener("click", openImport);
$("#confirmImportButton").addEventListener("click", importNodes);
$("#ipButton").addEventListener("click", checkIp);
$("#groupsButton").addEventListener("click", openGroups);
$("#createGroupButton").addEventListener("click", createGroupFromManager);
$("#quickCreateGroup").addEventListener("click", quickCreateGroup);
$("#saveFavoriteButton").addEventListener("click", saveFavorite);
$("#removeFavoriteButton").addEventListener("click", removeFavorite);
$("#nodeSearch").addEventListener("input", (event) => { searchQuery = event.target.value; renderNodes(); });
$("#groupFilter").addEventListener("change", (event) => { groupFilter = event.target.value; renderNodes(); });
$$(".tab").forEach((button) => button.addEventListener("click", () => selectImportTab(button.dataset.tab)));
$("#configFile").addEventListener("change", (event) => { $("#fileName").textContent = event.target.files[0]?.name || ".yaml / .yml / .txt / .conf"; });
chrome.runtime.onMessage.addListener((event) => {
  if (event.type === "STATE_CHANGED") { state = event.state; render(); }
});

loadState().then(() => {
  if (!globalThis.__PAGE_SHUTTLE_MOCK__) return;
  const view = new URLSearchParams(location.search).get("view");
  if (view === "settings") $("#settingsPanel").hidden = false;
  if (view === "manual") {
    state.settings.locationMode = "manual";
    $("#settingsPanel").hidden = false;
    renderSettings();
  }
  if (view === "groups") openGroups();
  if (view === "favorite") openFavorite(state.nodes[0]?.id);
}).catch((error) => showToast(error.message, true));
