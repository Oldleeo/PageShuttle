const assert = require("node:assert/strict");
globalThis.jsyaml = require("../extension/lib/js-yaml.min.js");
const importer = require("../extension/lib/importer.js");

const vless = importer.parseUri("vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&type=tcp&sni=www.microsoft.com&fp=chrome&pbk=public-key&sid=abcd#Reality%20Node");
assert.equal(vless.type, "vless");
assert.equal(vless.name, "Reality Node");
assert.equal(vless.security, "reality");
assert.equal(vless.publicKey, "public-key");
assert.equal(vless.requiresHelper, true);

const clash = importer.parseText(`
proxies:
  - name: Clash VLESS
    type: vless
    server: edge.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: ws
    tls: true
    servername: edge.example.com
    ws-opts:
      path: /websocket
      headers:
        Host: cdn.example.com
  - name: Office SOCKS
    type: socks5
    server: 127.0.0.1
    port: 1080
`);
assert.equal(clash.nodes.length, 2);
assert.equal(clash.nodes[0].path, "/websocket");
assert.equal(clash.nodes[0].host, "cdn.example.com");
assert.equal(clash.nodes[1].requiresHelper, false);

const subscriptionText = "http://user:pass@proxy.example.com:8080\nvless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls#Node";
const subscription = Buffer.from(subscriptionText, "utf8").toString("base64");
const decoded = importer.parseText(subscription);
assert.equal(decoded.nodes.length, 2);
assert.equal(decoded.nodes[0].username, "user");
assert.equal(decoded.nodes[1].type, "vless");

const vmessPayload = Buffer.from(JSON.stringify({ v: "2", ps: "VMess Test", add: "vmess.example.com", port: "443", id: "11111111-1111-1111-1111-111111111111", aid: "0", net: "grpc", tls: "tls", sni: "vmess.example.com", path: "service" })).toString("base64");
const vmess = importer.parseUri(`vmess://${vmessPayload}`);
assert.equal(vmess.type, "vmess");
assert.equal(vmess.serviceName, "service");

console.log("PARSER_TESTS_OK");
