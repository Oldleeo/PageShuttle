(() => {
  "use strict";

  let config = { enabled: false };
  const nativeLanguage = navigator.language;
  const nativeLanguages = Array.from(navigator.languages || [nativeLanguage]);
  const originalGeolocation = navigator.geolocation || null;
  const nativeGeoGet = originalGeolocation?.getCurrentPosition.bind(originalGeolocation);
  const nativeGeoWatch = originalGeolocation?.watchPosition.bind(originalGeolocation);
  const nativeGeoClear = originalGeolocation?.clearWatch.bind(originalGeolocation);
  const fakeWatchers = new Map();
  let watcherSequence = 1000000;

  function environmentEnabled() {
    return config?.enabled === true;
  }

  function locationEnabled() {
    return environmentEnabled() && Number.isFinite(config.latitude) && Number.isFinite(config.longitude);
  }

  function makePosition() {
    return {
      coords: {
        latitude: config.latitude,
        longitude: config.longitude,
        accuracy: config.accuracy || 25000,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON() { return { ...this }; }
      },
      timestamp: Date.now(),
      toJSON() { return { coords: this.coords, timestamp: this.timestamp }; }
    };
  }

  function deliverPosition(callback) {
    setTimeout(() => callback(makePosition()), 0);
  }

  if (originalGeolocation) {
    const replacement = {
      getCurrentPosition(success, error, options) {
        if (!locationEnabled()) return nativeGeoGet(success, error, options);
        if (typeof success !== "function") throw new TypeError("The success callback must be a function");
        deliverPosition(success);
      },
      watchPosition(success, error, options) {
        if (!locationEnabled()) return nativeGeoWatch(success, error, options);
        if (typeof success !== "function") throw new TypeError("The success callback must be a function");
        const id = ++watcherSequence;
        fakeWatchers.set(id, success);
        deliverPosition(success);
        return id;
      },
      clearWatch(id) {
        if (fakeWatchers.delete(id)) return;
        nativeGeoClear(id);
      }
    };
    try { Object.defineProperty(navigator, "geolocation", { configurable: true, get: () => replacement }); }
    catch {
      try { Object.defineProperty(Object.getPrototypeOf(navigator), "geolocation", { configurable: true, get: () => replacement }); } catch {}
    }
  }

  function installNavigatorGetter(name, getter) {
    const prototype = Object.getPrototypeOf(navigator);
    try { Object.defineProperty(prototype, name, { configurable: true, enumerable: true, get: getter }); return; } catch {}
    try { Object.defineProperty(navigator, name, { configurable: true, enumerable: true, get: getter }); } catch {}
  }

  installNavigatorGetter("language", () => environmentEnabled() && config.languageEnabled ? config.locale : nativeLanguage);
  installNavigatorGetter("languages", () => environmentEnabled() && config.languageEnabled ? Object.freeze([...config.languages]) : Object.freeze([...nativeLanguages]));
  for (const legacyName of ["userLanguage", "browserLanguage", "systemLanguage"]) {
    installNavigatorGetter(legacyName, () => environmentEnabled() && config.languageEnabled ? config.locale : nativeLanguage);
  }

  const originalIntl = new Map();
  function adjustedIntlArguments(name, args) {
    if (!environmentEnabled()) return args;
    const adjusted = [...args];
    if (config.languageEnabled && (adjusted[0] == null || (Array.isArray(adjusted[0]) && adjusted[0].length === 0))) adjusted[0] = config.locale;
    if (name === "DateTimeFormat" && config.timezoneEnabled) {
      adjusted[1] = { ...(adjusted[1] || {}) };
      if (!adjusted[1].timeZone) adjusted[1].timeZone = config.timeZone;
    }
    return adjusted;
  }

  for (const name of ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter"]) {
    const Original = Intl[name];
    if (typeof Original !== "function") continue;
    originalIntl.set(name, Original);
    try {
      let proxy;
      proxy = new Proxy(Original, {
        apply(target, thisArg, args) { return Reflect.apply(target, thisArg, adjustedIntlArguments(name, args)); },
        construct(target, args, newTarget) { return Reflect.construct(target, adjustedIntlArguments(name, args), newTarget === proxy ? target : newTarget); }
      });
      Intl[name] = proxy;
    } catch {
      Intl[name] = Original;
    }
  }

  const NativeDateTimeFormat = originalIntl.get("DateTimeFormat") || Intl.DateTimeFormat;
  const nativeDateGetTime = Date.prototype.getTime;
  const nativeDateGetUTCDay = Date.prototype.getUTCDay;
  const nativeDateToString = Date.prototype.toString;
  const nativeDateToDateString = Date.prototype.toDateString;
  const nativeDateToTimeString = Date.prototype.toTimeString;
  const nativeToLocaleString = Date.prototype.toLocaleString;
  const nativeToLocaleDateString = Date.prototype.toLocaleDateString;
  const nativeToLocaleTimeString = Date.prototype.toLocaleTimeString;
  const datePartFormatters = new Map();

  function formatterFor(timeZone) {
    if (!datePartFormatters.has(timeZone)) {
      datePartFormatters.set(timeZone, new NativeDateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        timeZone,
        year: "numeric", month: "short", day: "2-digit", weekday: "short",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
        timeZoneName: "long"
      }));
    }
    return datePartFormatters.get(timeZone);
  }

  function zonedParts(date) {
    const epoch = nativeDateGetTime.call(date);
    if (!Number.isFinite(epoch) || !environmentEnabled() || !config.timezoneEnabled || !config.timeZone) return null;
    let entries;
    try { entries = formatterFor(config.timeZone).formatToParts(date).map((part) => [part.type, part.value]); }
    catch { return null; }
    const parts = Object.fromEntries(entries);
    const monthNames = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    return {
      epoch,
      year: Number(parts.year),
      month: monthNames[parts.month] || 1,
      monthName: parts.month,
      day: Number(parts.day),
      weekday: parts.weekday,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
      timeZoneName: parts.timeZoneName || config.timeZone
    };
  }

  function timeZoneOffset(date, parts = zonedParts(date)) {
    if (!parts) return null;
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const epochSeconds = Math.floor(parts.epoch / 1000) * 1000;
    return Math.round((epochSeconds - localAsUtc) / 60000);
  }

  function patchDateMethod(name, replacement) {
    try { Object.defineProperty(Date.prototype, name, { configurable: true, writable: true, value: replacement }); } catch {}
  }

  const localGetters = {
    getFullYear: (parts) => parts.year,
    getYear: (parts) => parts.year - 1900,
    getMonth: (parts) => parts.month - 1,
    getDate: (parts) => parts.day,
    getDay: (parts) => nativeDateGetUTCDay.call(new Date(Date.UTC(parts.year, parts.month - 1, parts.day))),
    getHours: (parts) => parts.hour,
    getMinutes: (parts) => parts.minute,
    getSeconds: (parts) => parts.second
  };
  for (const [name, select] of Object.entries(localGetters)) {
    const nativeMethod = Date.prototype[name];
    patchDateMethod(name, function (...args) {
      const parts = zonedParts(this);
      return parts ? select(parts) : nativeMethod.apply(this, args);
    });
  }
  const nativeGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  patchDateMethod("getTimezoneOffset", function (...args) {
    const offset = timeZoneOffset(this);
    return offset == null ? nativeGetTimezoneOffset.apply(this, args) : offset;
  });
  patchDateMethod("toString", function (...args) {
    const parts = zonedParts(this);
    if (!parts) return nativeDateToString.apply(this, args);
    const offset = timeZoneOffset(this, parts);
    const sign = offset <= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    const hhmm = `${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
    return `${parts.weekday} ${parts.monthName} ${String(parts.day).padStart(2, "0")} ${parts.year} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")} GMT${sign}${hhmm} (${parts.timeZoneName})`;
  });
  patchDateMethod("toDateString", function (...args) {
    const parts = zonedParts(this);
    return parts ? `${parts.weekday} ${parts.monthName} ${String(parts.day).padStart(2, "0")} ${parts.year}` : nativeDateToDateString.apply(this, args);
  });
  patchDateMethod("toTimeString", function (...args) {
    const parts = zonedParts(this);
    if (!parts) return nativeDateToTimeString.apply(this, args);
    const offset = timeZoneOffset(this, parts);
    const sign = offset <= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")} GMT${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")} (${parts.timeZoneName})`;
  });

  function adjustedLocaleCall(nativeMethod, date, locales, options) {
    if (!environmentEnabled()) return nativeMethod.call(date, locales, options);
    const nextLocales = config.languageEnabled && locales == null ? config.locale : locales;
    const nextOptions = { ...(options || {}) };
    if (config.timezoneEnabled && !nextOptions.timeZone) nextOptions.timeZone = config.timeZone;
    return nativeMethod.call(date, nextLocales, nextOptions);
  }
  patchDateMethod("toLocaleString", function (locales, options) { return adjustedLocaleCall(nativeToLocaleString, this, locales, options); });
  patchDateMethod("toLocaleDateString", function (locales, options) { return adjustedLocaleCall(nativeToLocaleDateString, this, locales, options); });
  patchDateMethod("toLocaleTimeString", function (locales, options) { return adjustedLocaleCall(nativeToLocaleTimeString, this, locales, options); });

  try {
    if (globalThis.Temporal?.Now?.timeZoneId) {
      const nativeTimeZoneId = globalThis.Temporal.Now.timeZoneId.bind(globalThis.Temporal.Now);
      globalThis.Temporal.Now.timeZoneId = () => environmentEnabled() && config.timezoneEnabled ? config.timeZone : nativeTimeZoneId();
    }
  } catch {}

  function normalizedFont(value) {
    return String(value || "").replace(/["']/g, "").toLowerCase();
  }

  function fontList(name) {
    return Array.isArray(config[name]) ? config[name] : [];
  }

  function mentionsFont(cssFont, names) {
    const normalized = normalizedFont(cssFont);
    return names.some((name) => normalized.includes(normalizedFont(name)));
  }

  function fontPrivacyEnabled() {
    return environmentEnabled() && config.fontPrivacyMode !== "off";
  }

  function fallbackFont(cssFont) {
    let result = String(cssFont || "");
    const fallback = String(config.fontFallback || "Arial");
    for (const name of [...fontList("hiddenFonts")].sort((a, b) => b.length - a.length)) {
      result = result.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), fallback);
    }
    return result;
  }

  if (globalThis.FontFaceSet?.prototype?.check) {
    const nativeFontCheck = FontFaceSet.prototype.check;
    try {
      Object.defineProperty(FontFaceSet.prototype, "check", {
        configurable: true,
        writable: true,
        value(font, text) {
          if (fontPrivacyEnabled()) {
            if (mentionsFont(font, fontList("hiddenFonts"))) return false;
            if (mentionsFont(font, fontList("reportedFonts"))) return true;
          }
          return nativeFontCheck.call(this, font, text);
        }
      });
    } catch {}
  }

  if (typeof window.queryLocalFonts === "function") {
    const nativeQueryLocalFonts = window.queryLocalFonts.bind(window);
    try {
      Object.defineProperty(window, "queryLocalFonts", {
        configurable: true,
        writable: true,
        async value(...args) {
          const fonts = await nativeQueryLocalFonts(...args);
          if (!fontPrivacyEnabled()) return fonts;
          return fonts.filter((font) => !mentionsFont(`${font.family} ${font.fullName} ${font.postscriptName}`, fontList("hiddenFonts")));
        }
      });
    } catch {}
  }

  function patchCanvasContext(ContextType) {
    if (!ContextType?.prototype?.measureText) return;
    const nativeMeasureText = ContextType.prototype.measureText;
    try {
      Object.defineProperty(ContextType.prototype, "measureText", {
        configurable: true,
        writable: true,
        value(text) {
          const currentFont = this.font;
          if (!fontPrivacyEnabled() || !mentionsFont(currentFont, fontList("hiddenFonts"))) return nativeMeasureText.call(this, text);
          try {
            this.font = fallbackFont(currentFont);
            return nativeMeasureText.call(this, text);
          } finally {
            this.font = currentFont;
          }
        }
      });
    } catch {}
  }
  patchCanvasContext(globalThis.CanvasRenderingContext2D);
  patchCanvasContext(globalThis.OffscreenCanvasRenderingContext2D);

  const measuringElements = new WeakSet();
  function withFallbackElementFont(element, callback) {
    if (!fontPrivacyEnabled() || config.fontPrivacyMode !== "strict" || !element?.style || measuringElements.has(element)) return callback();
    let computed;
    try { computed = getComputedStyle(element).fontFamily; } catch { return callback(); }
    if (!mentionsFont(computed, fontList("hiddenFonts"))) return callback();
    measuringElements.add(element);
    const oldValue = element.style.getPropertyValue("font-family");
    const oldPriority = element.style.getPropertyPriority("font-family");
    try {
      element.style.setProperty("font-family", config.fontFallback || "Arial", "important");
      return callback();
    } finally {
      if (oldValue) element.style.setProperty("font-family", oldValue, oldPriority);
      else element.style.removeProperty("font-family");
      measuringElements.delete(element);
    }
  }

  function patchMetricGetter(Type, name) {
    const descriptor = Type?.prototype && Object.getOwnPropertyDescriptor(Type.prototype, name);
    if (!descriptor?.get) return;
    try {
      Object.defineProperty(Type.prototype, name, {
        ...descriptor,
        get() { return withFallbackElementFont(this, () => descriptor.get.call(this)); }
      });
    } catch {}
  }
  for (const name of ["offsetWidth", "offsetHeight"]) patchMetricGetter(globalThis.HTMLElement, name);
  for (const name of ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) patchMetricGetter(globalThis.Element, name);
  for (const name of ["getBoundingClientRect", "getClientRects"]) {
    const nativeMethod = globalThis.Element?.prototype?.[name];
    if (typeof nativeMethod !== "function") continue;
    try {
      Object.defineProperty(Element.prototype, name, {
        configurable: true,
        writable: true,
        value(...args) { return withFallbackElementFont(this, () => nativeMethod.apply(this, args)); }
      });
    } catch {}
  }

  function sanitizeIncoming(value) {
    if (!value || value.enabled !== true) return { enabled: false };
    const privacy = ["off", "balanced", "strict"].includes(value.fontPrivacyMode) ? value.fontPrivacyMode : "strict";
    return {
      enabled: true,
      latitude: Number(value.latitude),
      longitude: Number(value.longitude),
      accuracy: Number(value.accuracy) || 25000,
      locale: String(value.locale || "en-US").slice(0, 40),
      languages: (Array.isArray(value.languages) ? value.languages : [value.locale || "en-US"]).slice(0, 8).map((item) => String(item).slice(0, 40)),
      timeZone: String(value.timeZone || "UTC").slice(0, 80),
      timezoneEnabled: value.timezoneEnabled !== false,
      languageEnabled: value.languageEnabled !== false,
      fontPrivacyMode: privacy,
      hiddenFonts: (Array.isArray(value.hiddenFonts) ? value.hiddenFonts : []).slice(0, 80).map((item) => String(item).slice(0, 100)),
      reportedFonts: (Array.isArray(value.reportedFonts) ? value.reportedFonts : []).slice(0, 40).map((item) => String(item).slice(0, 100)),
      fontFallback: String(value.fontFallback || "Arial").slice(0, 100)
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "page-shuttle-environment-bridge" || event.data?.type !== "UPDATE") return;
    config = sanitizeIncoming(event.data.value);
    if (locationEnabled()) {
      for (const callback of fakeWatchers.values()) deliverPosition(callback);
    }
  });

  window.postMessage({ source: "page-shuttle-environment-main", type: "READY" }, "*");
})();
