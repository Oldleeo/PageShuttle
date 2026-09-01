const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const executable = process.argv[2];
if (!executable) throw new Error("Usage: node native-host.test.cjs <ChromeProxyHost.exe>");
const host = spawn(path.resolve(executable), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let buffer = Buffer.alloc(0);
const waiters = new Map();

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

host.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const reply = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
    buffer = buffer.subarray(4 + length);
    const waiter = waiters.get(reply.id);
    if (waiter) {
      waiters.delete(reply.id);
      waiter.resolve(reply);
    }
  }
});

function request(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(message.id);
      reject(new Error(`Timed out waiting for ${message.id}`));
    }, 15000);
    waiters.set(message.id, {
      resolve(value) { clearTimeout(timeout); resolve(value); },
      reject
    });
    host.stdin.write(frame(message));
  });
}

function connectLoopback(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve();
    });
    socket.setTimeout(3000, () => socket.destroy(new Error("Loopback connection timed out")));
    socket.on("error", reject);
  });
}

(async () => {
  const ping = await request({ id: "ping", action: "ping" });
  assert.equal(ping.ok, true);
  const start = await request({
    id: "start",
    action: "start",
    node: {
      type: "vless",
      server: "example.com",
      port: 443,
      uuid: "11111111-1111-1111-1111-111111111111",
      network: "ws",
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/ws",
      fingerprint: "chrome"
    }
  });
  assert.equal(start.ok, true);
  assert.equal(start.protocol, "socks5");
  assert.ok(start.port > 0 && start.port < 65536);
  await connectLoopback(start.port);
  const running = await request({ id: "running", action: "status" });
  assert.equal(running.running, true);
  assert.equal(running.port, start.port);
  const stop = await request({ id: "stop", action: "stop" });
  assert.equal(stop.ok, true);
  const stopped = await request({ id: "stopped", action: "status" });
  assert.equal(stopped.running, false);
  host.stdin.end();
  await new Promise((resolve, reject) => {
    host.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Host exited ${code}`)));
  });
  console.log("NATIVE_HOST_PROTOCOL_OK");
  console.log("XRAY_LOOPBACK_START_STOP_OK");
})().catch((error) => {
  host.kill();
  console.error(error);
  process.exitCode = 1;
});
