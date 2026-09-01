const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(`
  const listeners = new Map();
  class NavigatorMock {}
  const nativePosition = { coords: { latitude: 51.5, longitude: -0.12, accuracy: 10 }, timestamp: 1 };
  const originalGeolocation = {
    getCurrentPosition(success) { success(nativePosition); },
    watchPosition(success) { success(nativePosition); return 77; },
    clearWatch() {}
  };
  Object.defineProperties(NavigatorMock.prototype, {
    language: { configurable: true, get() { return "en-GB"; } },
    languages: { configurable: true, get() { return Object.freeze(["en-GB"]); } }
  });
  globalThis.navigator = new NavigatorMock();
  Object.defineProperties(navigator, {
    geolocation: { configurable: true, value: originalGeolocation }
  });
  globalThis.window = globalThis;
  window.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  };
  window.postMessage = (data) => {
    for (const listener of listeners.get("message") || []) listener({ source: window, data });
  };
  class FontFaceSetMock { check() { return true; } }
  globalThis.FontFaceSet = FontFaceSetMock;
  class CanvasContextMock {
    constructor() { this.font = "16px Arial"; }
    measureText() { return { width: this.font.includes("Microsoft YaHei") ? 18 : 10 }; }
  }
  globalThis.CanvasRenderingContext2D = CanvasContextMock;
  globalThis.OffscreenCanvasRenderingContext2D = undefined;
  class ElementMock {
    constructor() {
      this.style = {
        value: "",
        getPropertyValue() { return this.value; },
        getPropertyPriority() { return ""; },
        setProperty(_name, value) { this.value = value; },
        removeProperty() { this.value = ""; }
      };
    }
    get clientWidth() { return 100; }
    get clientHeight() { return 20; }
    get scrollWidth() { return 100; }
    get scrollHeight() { return 20; }
    getBoundingClientRect() { return { width: 100, height: 20 }; }
    getClientRects() { return []; }
  }
  class HTMLElementMock extends ElementMock {
    get offsetWidth() { return 100; }
    get offsetHeight() { return 20; }
  }
  globalThis.Element = ElementMock;
  globalThis.HTMLElement = HTMLElementMock;
  globalThis.getComputedStyle = () => ({ fontFamily: "Microsoft YaHei" });
  window.queryLocalFonts = async () => [
    { family: "Microsoft YaHei", fullName: "Microsoft YaHei", postscriptName: "MicrosoftYaHei" },
    { family: "Arial", fullName: "Arial", postscriptName: "ArialMT" }
  ];
`, context);

const script = fs.readFileSync(path.join(__dirname, "..", "extension", "location-main.js"), "utf8");
vm.runInContext(script, context);

const profile = {
  enabled: true,
  latitude: 40.7128,
  longitude: -74.006,
  accuracy: 777,
  locale: "en-US",
  languages: ["en-US", "zh-CN"],
  timeZone: "America/New_York",
  timezoneEnabled: true,
  languageEnabled: true,
  fontPrivacyMode: "strict",
  hiddenFonts: ["Microsoft YaHei", "PingFang SC"],
  reportedFonts: ["Arial", "Times New Roman"],
  fontFallback: "Arial"
};
context.profileJson = JSON.stringify(profile);
vm.runInContext(`window.postMessage({ source: "page-shuttle-environment-bridge", type: "UPDATE", value: JSON.parse(profileJson) })`, context);

(async () => {
  const position = await vm.runInContext(`new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject))`, context);
  assert.equal(position.coords.latitude, 40.7128);
  assert.equal(position.coords.longitude, -74.006);
  assert.equal(position.coords.accuracy, 777);

  assert.equal(vm.runInContext("navigator.language", context), "en-US");
  assert.deepEqual(Array.from(vm.runInContext("navigator.languages", context)), ["en-US", "zh-CN"]);
  assert.equal(vm.runInContext("new Intl.DateTimeFormat().resolvedOptions().timeZone", context), "America/New_York");
  assert.equal(vm.runInContext("new Intl.NumberFormat().resolvedOptions().locale", context), "en-US");
  assert.equal(vm.runInContext("new Date('2026-01-01T12:00:00Z').getHours()", context), 7);
  assert.equal(vm.runInContext("new Date('2026-01-01T12:00:00Z').getTimezoneOffset()", context), 300);

  assert.equal(vm.runInContext("new FontFaceSet().check('16px Microsoft YaHei')", context), false);
  assert.equal(vm.runInContext("new FontFaceSet().check('16px Arial')", context), true);
  assert.equal(vm.runInContext(`(() => { const c = new CanvasRenderingContext2D(); c.font = "16px Microsoft YaHei"; const width = c.measureText("测试").width; return width + ":" + c.font; })()`, context), "10:16px Microsoft YaHei");
  assert.deepEqual(Array.from(await vm.runInContext("window.queryLocalFonts().then((fonts) => fonts.map((font) => font.family))", context)), ["Arial"]);

  vm.runInContext(`window.postMessage({ source: "page-shuttle-environment-bridge", type: "UPDATE", value: { enabled: false } })`, context);
  const restored = await vm.runInContext(`new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject))`, context);
  assert.equal(restored.coords.latitude, 51.5);
  assert.equal(vm.runInContext("navigator.language", context), "en-GB");
  assert.equal(vm.runInContext(`(() => { const c = new CanvasRenderingContext2D(); c.font = "16px Microsoft YaHei"; return c.measureText("测试").width; })()`, context), 18);

  console.log("WEB_ENVIRONMENT_OVERRIDE_OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
