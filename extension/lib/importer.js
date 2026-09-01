(function (root) {
  "use strict";

  const CORE_TYPES = new Set(["vless", "vmess", "trojan", "ss"]);
  const DIRECT_TYPES = new Set(["http", "https", "socks4", "socks5"]);

  function decodeBase64Utf8(value) {
    let normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    let binary;
    if (typeof atob === "function") binary = atob(normalized);
    else binary = Buffer.from(normalized, "base64").toString("binary");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value || ""); } catch { return value || ""; }
  }

  function makeId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function asPort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须介于 1–65535");
    return port;
  }

  function cleanNode(node) {
    const cleaned = { ...node };
    cleaned.id ||= makeId();
    cleaned.name = String(cleaned.name || `${cleaned.type} ${cleaned.server}`).trim();
    cleaned.type = String(cleaned.type || "").toLowerCase();
    cleaned.server = String(cleaned.server || "").trim();
    cleaned.port = asPort(cleaned.port);
    if (!cleaned.server) throw new Error("缺少服务器地址");
    cleaned.requiresHelper = CORE_TYPES.has(cleaned.type);
    cleaned.supported = cleaned.requiresHelper || DIRECT_TYPES.has(cleaned.type);
    if (!cleaned.supported) cleaned.unsupportedReason = `暂不支持 ${cleaned.type || "未知"} 协议`;
    return cleaned;
  }

  function parseStandardUrl(raw) {
    const url = new URL(raw);
    const type = url.protocol.slice(0, -1).toLowerCase();
    const node = {
      type,
      name: safeDecode(url.hash.slice(1)) || `${type.toUpperCase()} ${url.hostname}`,
      server: url.hostname,
      port: url.port || (type === "https" ? 443 : type === "http" ? 80 : 1080),
      username: safeDecode(url.username),
      password: safeDecode(url.password)
    };
    return cleanNode(node);
  }

  function parseVless(raw) {
    const url = new URL(raw);
    const query = url.searchParams;
    const security = (query.get("security") || (query.get("tls") === "true" ? "tls" : "none")).toLowerCase();
    return cleanNode({
      type: "vless",
      name: safeDecode(url.hash.slice(1)) || `VLESS ${url.hostname}`,
      server: url.hostname,
      port: url.port || 443,
      uuid: safeDecode(url.username),
      encryption: query.get("encryption") || "none",
      flow: query.get("flow") || "",
      network: (query.get("type") || "tcp").toLowerCase(),
      security,
      sni: query.get("sni") || query.get("serverName") || "",
      allowInsecure: ["1", "true"].includes((query.get("allowInsecure") || "").toLowerCase()),
      fingerprint: query.get("fp") || "chrome",
      host: query.get("host") || "",
      path: safeDecode(query.get("path") || ""),
      serviceName: safeDecode(query.get("serviceName") || ""),
      mode: query.get("mode") || "",
      publicKey: query.get("pbk") || query.get("publicKey") || "",
      shortId: query.get("sid") || query.get("shortId") || "",
      spiderX: safeDecode(query.get("spx") || query.get("spiderX") || ""),
      alpn: (query.get("alpn") || "").split(",").filter(Boolean),
      headerType: query.get("headerType") || "none"
    });
  }

  function parseTrojan(raw) {
    const url = new URL(raw);
    const query = url.searchParams;
    return cleanNode({
      type: "trojan",
      name: safeDecode(url.hash.slice(1)) || `Trojan ${url.hostname}`,
      server: url.hostname,
      port: url.port || 443,
      password: safeDecode(url.username),
      network: (query.get("type") || "tcp").toLowerCase(),
      security: (query.get("security") || "tls").toLowerCase(),
      sni: query.get("sni") || "",
      allowInsecure: ["1", "true"].includes((query.get("allowInsecure") || "").toLowerCase()),
      fingerprint: query.get("fp") || "chrome",
      host: query.get("host") || "",
      path: safeDecode(query.get("path") || ""),
      serviceName: safeDecode(query.get("serviceName") || ""),
      publicKey: query.get("pbk") || "",
      shortId: query.get("sid") || ""
    });
  }

  function parseVmess(raw) {
    const payload = JSON.parse(decodeBase64Utf8(raw.slice("vmess://".length)));
    return cleanNode({
      type: "vmess",
      name: payload.ps || `VMess ${payload.add}`,
      server: payload.add,
      port: payload.port,
      uuid: payload.id,
      alterId: Number(payload.aid || 0),
      cipher: payload.scy || "auto",
      network: (payload.net || "tcp").toLowerCase(),
      security: payload.tls === "tls" ? "tls" : (payload.tls || "none"),
      sni: payload.sni || "",
      host: payload.host || "",
      path: payload.path || "",
      serviceName: payload.path || "",
      fingerprint: payload.fp || "chrome",
      headerType: payload.type || "none",
      alpn: String(payload.alpn || "").split(",").filter(Boolean)
    });
  }

  function parseShadowsocks(raw) {
    let body = raw.slice("ss://".length);
    const hashAt = body.indexOf("#");
    const name = hashAt >= 0 ? safeDecode(body.slice(hashAt + 1)) : "";
    if (hashAt >= 0) body = body.slice(0, hashAt);
    body = body.split("?")[0];
    let credentials;
    let endpoint;
    if (body.includes("@")) {
      const at = body.lastIndexOf("@");
      const encodedCredentials = body.slice(0, at);
      endpoint = body.slice(at + 1);
      try { credentials = decodeBase64Utf8(encodedCredentials); } catch { credentials = safeDecode(encodedCredentials); }
    } else {
      const decoded = decodeBase64Utf8(body);
      const at = decoded.lastIndexOf("@");
      if (at < 0) throw new Error("Shadowsocks 链接缺少服务器");
      credentials = decoded.slice(0, at);
      endpoint = decoded.slice(at + 1);
    }
    const split = credentials.indexOf(":");
    if (split < 1) throw new Error("Shadowsocks 链接缺少加密方式");
    const endpointUrl = new URL(`http://${endpoint}`);
    return cleanNode({
      type: "ss",
      name: name || `SS ${endpointUrl.hostname}`,
      server: endpointUrl.hostname,
      port: endpointUrl.port,
      cipher: credentials.slice(0, split),
      password: credentials.slice(split + 1)
    });
  }

  function parseUri(raw) {
    const value = String(raw || "").trim();
    const scheme = value.match(/^([a-zA-Z0-9+.-]+):\/\//)?.[1]?.toLowerCase();
    if (!scheme) throw new Error("不是有效的代理链接");
    if (["http", "https", "socks4", "socks5"].includes(scheme)) return parseStandardUrl(value);
    if (scheme === "vless") return parseVless(value);
    if (scheme === "vmess") return parseVmess(value);
    if (scheme === "trojan") return parseTrojan(value);
    if (scheme === "ss") return parseShadowsocks(value);
    throw new Error(`暂不支持 ${scheme} 链接`);
  }

  function clashNodeToNode(proxy) {
    const type = String(proxy.type || "").toLowerCase();
    const ws = proxy["ws-opts"] || {};
    const grpc = proxy["grpc-opts"] || {};
    const reality = proxy["reality-opts"] || {};
    const headers = ws.headers || {};
    const security = reality["public-key"] ? "reality" : proxy.tls ? "tls" : "none";
    return cleanNode({
      type: type === "socks" ? "socks5" : type === "shadowsocks" ? "ss" : type,
      name: proxy.name,
      server: proxy.server,
      port: proxy.port,
      username: proxy.username || "",
      password: proxy.password || "",
      uuid: proxy.uuid || "",
      alterId: Number(proxy.alterId ?? proxy.alterId ?? 0),
      cipher: proxy.cipher || (type === "vmess" ? "auto" : ""),
      encryption: proxy.encryption || "none",
      flow: proxy.flow || "",
      network: String(proxy.network || "tcp").toLowerCase(),
      security,
      sni: proxy.servername || proxy.sni || "",
      allowInsecure: Boolean(proxy["skip-cert-verify"]),
      fingerprint: proxy["client-fingerprint"] || "chrome",
      host: headers.Host || headers.host || ws.host || "",
      path: ws.path || "",
      serviceName: grpc["grpc-service-name"] || grpc.serviceName || "",
      mode: grpc["grpc-mode"] || "",
      publicKey: reality["public-key"] || "",
      shortId: reality["short-id"] || "",
      spiderX: reality["spider-x"] || "",
      alpn: Array.isArray(proxy.alpn) ? proxy.alpn : [],
      headerType: proxy["header-type"] || "none"
    });
  }

  function parseClash(text) {
    if (!root.jsyaml?.load) throw new Error("YAML 解析组件未加载");
    const document = root.jsyaml.load(text);
    if (!document || !Array.isArray(document.proxies)) throw new Error("该 Clash 配置中没有 proxies 节点列表");
    const nodes = [];
    const errors = [];
    for (const proxy of document.proxies) {
      try { nodes.push(clashNodeToNode(proxy)); }
      catch (error) { errors.push(`${proxy?.name || "未命名节点"}: ${error.message}`); }
    }
    return { nodes, errors };
  }

  function maybeDecodeSubscription(text) {
    const compact = String(text || "").trim().replace(/\s+/g, "");
    if (!compact || /[:\n{}\-]/.test(compact)) return text;
    try {
      const decoded = decodeBase64Utf8(compact);
      return decoded.includes("://") ? decoded : text;
    } catch { return text; }
  }

  function parseText(input) {
    let text = String(input || "").replace(/^\uFEFF/, "").trim();
    if (!text) return { nodes: [], errors: ["导入内容为空"] };
    if (/^\s*(proxies|mixed-port|proxy-groups|proxy-providers)\s*:/m.test(text)) return parseClash(text);
    text = maybeDecodeSubscription(text);
    const nodes = [];
    const errors = [];
    const links = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const link of links) {
      try { nodes.push(parseUri(link)); }
      catch (error) { errors.push(`${link.slice(0, 48)}: ${error.message}`); }
    }
    return { nodes, errors };
  }

  const api = { parseText, parseUri, parseClash, clashNodeToNode, decodeBase64Utf8, cleanNode };
  root.ProxyImporter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
