const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const executable = process.argv[2];
const manifestPath = process.argv[3];
if (!executable || !manifestPath) throw new Error("Usage: node update-feed.test.cjs <ChromeProxyHost.exe> <update-manifest.json>");
const expected = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
const host = spawn(path.resolve(executable), [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

(async () => {
  const reply = await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for update feed")), 45000);
    host.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      clearTimeout(timeout);
      resolve(JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
    });
    host.once("error", reject);
    host.stdin.write(frame({ id: "update", action: "check_update" }));
  });
  assert.equal(reply.ok, true, reply.error);
  assert.equal(String(reply.currentVersion).split("+")[0], expected.version);
  assert.equal(reply.available, false);
  assert.equal(reply.update.version, expected.version);
  assert.equal(reply.update.sha256, expected.sha256);
  host.stdin.end();
  console.log("PUBLIC_UPDATE_FEED_OK");
  console.log(`VERSION=${reply.update.version}`);
})().catch((error) => {
  host.kill();
  console.error(error);
  process.exitCode = 1;
});
