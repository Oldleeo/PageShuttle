(() => {
  "use strict";

  function safeArray(value, limit) {
    return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => String(item));
  }

  async function sendEnvironment() {
    const stored = await chrome.storage.local.get("locationOverride");
    const value = stored.locationOverride || { enabled: false };
    window.postMessage({
      source: "page-shuttle-environment-bridge",
      type: "UPDATE",
      value: {
        enabled: value.enabled === true,
        latitude: Number(value.latitude),
        longitude: Number(value.longitude),
        accuracy: Number(value.accuracy),
        locale: String(value.locale || "en-US"),
        languages: safeArray(value.languages, 8),
        timeZone: String(value.timeZone || "UTC"),
        timezoneEnabled: value.timezoneEnabled !== false,
        languageEnabled: value.languageEnabled !== false,
        fontPrivacyMode: String(value.fontPrivacyMode || "strict"),
        hiddenFonts: safeArray(value.hiddenFonts, 80),
        reportedFonts: safeArray(value.reportedFonts, 40),
        fontFallback: String(value.fontFallback || "Arial")
      }
    }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.source === "page-shuttle-environment-main" && event.data?.type === "READY") {
      sendEnvironment().catch(() => {});
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.locationOverride) sendEnvironment().catch(() => {});
  });
  sendEnvironment().catch(() => {});
})();
