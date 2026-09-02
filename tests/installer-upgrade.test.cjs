const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Usage: node installer-upgrade.test.cjs <package-root>");

const resolvedPackage = path.resolve(packageRoot);
const expectedVersion = JSON.parse(fs.readFileSync(path.join(resolvedPackage, "extension", "manifest.json"), "utf8")).version;
const installer = path.join(resolvedPackage, "Install.ps1");
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pageshuttle-installer-"));
let xray;

function runInstaller() {
  return spawnSync(powershell, [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", installer,
    "-InstallRoot", testRoot,
    "-SkipRegistry",
    "-NoLaunch"
  ], { encoding: "buffer", windowsHide: true, timeout: 30000 });
}

function processFailure(result) {
  return [
    result.error && result.error.stack,
    result.stderr && result.stderr.toString("utf8"),
    result.stdout && result.stdout.toString("utf8")
  ].filter(Boolean).join("\n") || `Process exited with status ${result.status}`;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error("Timed out waiting for temporary Xray"));
        else setTimeout(attempt, 100);
      });
    }
    attempt();
  });
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Xray to exit")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

(async () => {
  const firstInstall = runInstaller();
  assert.equal(firstInstall.status, 0, processFailure(firstInstall));

  const port = await getFreePort();
  const configPath = path.join(testRoot, "test-xray.json");
  fs.writeFileSync(configPath, JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: false } }],
    outbounds: [{ protocol: "freedom", tag: "direct" }]
  }), "utf8");

  const xrayPath = path.join(testRoot, "helper", "xray", "xray.exe");
  xray = spawn(xrayPath, ["run", "-config", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  await waitForPort(port);

  const upgrade = runInstaller();
  assert.equal(upgrade.status, 0, processFailure(upgrade));
  await waitForExit(xray);
  assert.equal(JSON.parse(fs.readFileSync(path.join(testRoot, "extension", "manifest.json"), "utf8")).version, expectedVersion);
  assert.equal(fs.existsSync(path.join(testRoot, "helper", "PageShuttleUpdater.exe")), true);

  console.log("INSTALLER_LOCKED_UPGRADE_OK");
  console.log("EXACT_PATH_PROCESS_FILTER_OK");
})().finally(() => {
  if (xray && xray.exitCode === null) xray.kill();
  const expectedPrefix = path.join(os.tmpdir(), "pageshuttle-installer-");
  if (testRoot.startsWith(expectedPrefix)) fs.rmSync(testRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
