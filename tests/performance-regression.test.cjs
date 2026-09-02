const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "extension", "location-main.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "extension", "popup.html"), "utf8");
const background = fs.readFileSync(path.join(root, "extension", "background.js"), "utf8");

for (const forbidden of [
  "FontFaceSet.prototype",
  "queryLocalFonts",
  "CanvasRenderingContext2D",
  "measureText",
  "offsetWidth",
  "offsetHeight",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "getBoundingClientRect",
  "getClientRects"
]) {
  assert.equal(main.includes(forbidden), false, `location-main.js must not patch ${forbidden}`);
}

assert.equal(/fontPrivacy|hiddenFonts|reportedFonts|fontFallback/i.test(main), false);
assert.equal(/字体(?:指纹|探测|保护)/.test(popup), false);
assert.match(popup, /网页时间跟随代理国家/);
assert.match(popup, /默认关闭；开启后复杂网页可能出现卡顿/);
assert.match(background, /matchTimezone:\s*false/);

console.log("NO_FONT_HOOKS_OK");
console.log("TIMEZONE_DEFAULT_OFF_WARNING_OK");
