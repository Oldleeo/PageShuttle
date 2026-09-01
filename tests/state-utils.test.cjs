const assert = require("node:assert/strict");
const state = require("../extension/lib/state-utils.js");

const groups = [{ id: "asia", name: "亚洲常用" }, { id: "work", name: "工作" }];
const nodes = [
  { id: "sg", name: "Singapore Reality", server: "sg.example.com", type: "vless", favoriteGroupId: "asia" },
  { id: "jp", name: "日本东京", server: "jp.example.com", type: "trojan", favoriteGroupId: null },
  { id: "us", name: "US Office", server: "us.example.com", type: "socks5", favoriteGroupId: "work" }
];

assert.deepEqual(state.filterNodes(nodes, groups, "sing", "all").map((node) => node.id), ["sg"]);
assert.deepEqual(state.filterNodes(nodes, groups, "亚洲", "all").map((node) => node.id), ["sg"]);
assert.deepEqual(state.filterNodes(nodes, groups, "", "favorites").map((node) => node.id), ["sg", "us"]);
assert.deepEqual(state.filterNodes(nodes, groups, "", "work").map((node) => node.id), ["us"]);

const favorited = state.setNodeFavorite(nodes, "jp", "asia");
assert.equal(favorited.find((node) => node.id === "jp").favoriteGroupId, "asia");
const removed = state.removeFavoriteGroup(favorited, groups, "asia");
assert.equal(removed.groups.length, 1);
assert.equal(removed.nodes.find((node) => node.id === "sg").favoriteGroupId, null);
assert.equal(removed.nodes.find((node) => node.id === "jp").favoriteGroupId, null);

assert.deepEqual(state.validateManualLocation({ manualLatitude: "1.3521", manualLongitude: "103.8198", manualAccuracy: "500", manualLabel: "SG" }), {
  latitude: 1.3521,
  longitude: 103.8198,
  accuracy: 500,
  label: "SG"
});
assert.throws(() => state.validateManualLocation({ manualLatitude: "91", manualLongitude: "0" }), /纬度/);
assert.throws(() => state.validateManualLocation({ manualLatitude: "0", manualLongitude: "181" }), /经度/);

const geo = state.normalizeGeoResponse({ success: true, ip: "203.0.113.5", country: "Singapore", city: "Singapore", latitude: 1.35, longitude: 103.82, timezone: { id: "Asia/Singapore" } });
assert.equal(geo.ip, "203.0.113.5");
assert.equal(geo.label, "Singapore Singapore");
assert.equal(geo.timezone, "Asia/Singapore");
assert.throws(() => state.normalizeGeoResponse({ success: false, message: "rate limit" }), /rate limit/);

assert.equal(state.localeForCountry("US"), "en-US");
assert.equal(state.localeForCountry("jp"), "ja-JP");
assert.equal(state.localeForCountry("IS"), "is-IS");
assert.equal(state.localeForCountry(""), "en-US");
assert.equal(state.validateLocale("en-us"), "en-US");
assert.equal(state.validateTimeZone("America/New_York"), "America/New_York");
assert.throws(() => state.validateLocale("not_a_locale"), /语言代码/);
assert.throws(() => state.validateTimeZone("Earth/Nowhere"), /时区/);

const autoEnvironment = state.buildEnvironmentProfile({
  ip: "198.51.100.2", country: "United States", countryCode: "US", city: "New York",
  latitude: 40.7128, longitude: -74.006, accuracy: 25000, label: "United States New York",
  timezone: "America/New_York"
}, {
  matchTimezone: true, matchLanguage: true, fontPrivacyMode: "strict"
}, "auto");
assert.equal(autoEnvironment.countryCode, "US");
assert.equal(autoEnvironment.locale, "en-US");
assert.deepEqual(autoEnvironment.languages, ["en-US"]);
assert.equal(autoEnvironment.timeZone, "America/New_York");
assert.equal(autoEnvironment.timezoneEnabled, true);
assert.equal(autoEnvironment.languageEnabled, true);
assert.equal(autoEnvironment.hiddenFonts.includes("Microsoft YaHei"), true);
assert.equal(autoEnvironment.reportedFonts.includes("Arial"), true);

const manualEnvironment = state.buildEnvironmentProfile(null, {
  manualLatitude: "35.6762", manualLongitude: "139.6503", manualAccuracy: "500", manualLabel: "东京",
  manualCountryCode: "JP", manualTimezone: "Asia/Tokyo", manualLocale: "ja-JP",
  matchTimezone: false, matchLanguage: false, fontPrivacyMode: "balanced"
}, "manual");
assert.equal(manualEnvironment.timeZone, "");
assert.equal(manualEnvironment.timezoneEnabled, false);
assert.equal(manualEnvironment.languageEnabled, false);
assert.equal(manualEnvironment.fontFallback, "Yu Gothic");
assert.equal(manualEnvironment.fontPrivacyMode, "balanced");

console.log("SEARCH_FAVORITES_TESTS_OK");
console.log("LOCATION_VALIDATION_TESTS_OK");
console.log("ENVIRONMENT_PROFILE_TESTS_OK");
