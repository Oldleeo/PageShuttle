(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PageShuttleState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeText(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
  }

  function normalizeGroups(groups) {
    const seen = new Set();
    return (Array.isArray(groups) ? groups : []).filter((group) => {
      if (!group || !group.id || !String(group.name || "").trim() || seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    }).map((group) => ({ id: String(group.id), name: String(group.name).trim() }));
  }

  function setNodeFavorite(nodes, nodeId, groupId) {
    return (Array.isArray(nodes) ? nodes : []).map((node) => node.id === nodeId
      ? { ...node, favoriteGroupId: groupId || null }
      : node);
  }

  function removeFavoriteGroup(nodes, groups, groupId) {
    return {
      groups: normalizeGroups(groups).filter((group) => group.id !== groupId),
      nodes: (Array.isArray(nodes) ? nodes : []).map((node) => node.favoriteGroupId === groupId
        ? { ...node, favoriteGroupId: null }
        : node)
    };
  }

  function filterNodes(nodes, groups, query, groupFilter) {
    const groupMap = new Map(normalizeGroups(groups).map((group) => [group.id, group.name]));
    const needle = normalizeText(query);
    return (Array.isArray(nodes) ? nodes : []).filter((node) => {
      if (groupFilter === "favorites" && !node.favoriteGroupId) return false;
      if (groupFilter && groupFilter !== "all" && groupFilter !== "favorites" && node.favoriteGroupId !== groupFilter) return false;
      if (!needle) return true;
      const fields = [node.name, node.server, node.type, node.network, node.security, groupMap.get(node.favoriteGroupId)];
      return fields.some((field) => normalizeText(field).includes(needle));
    });
  }

  function validateManualLocation(settings) {
    const latitude = Number(settings.manualLatitude);
    const longitude = Number(settings.manualLongitude);
    const accuracy = settings.manualAccuracy === "" || settings.manualAccuracy == null ? 1000 : Number(settings.manualAccuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error("纬度必须在 -90 到 90 之间");
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("经度必须在 -180 到 180 之间");
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 1000000) throw new Error("定位精度必须在 1 到 1000000 米之间");
    return {
      latitude,
      longitude,
      accuracy,
      label: String(settings.manualLabel || "手动位置").trim() || "手动位置"
    };
  }

  function normalizeGeoResponse(data) {
    if (!data || data.success === false) throw new Error(data?.message || "IP 定位服务返回失败");
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("IP 定位服务未返回有效坐标");
    }
    const parts = [data.country, data.region, data.city].filter(Boolean);
    return {
      ip: String(data.ip || ""),
      country: String(data.country || ""),
      countryCode: String(data.country_code || ""),
      region: String(data.region || ""),
      city: String(data.city || ""),
      latitude,
      longitude,
      accuracy: 25000,
      label: parts.join(" ") || "IP 估算位置",
      timezone: typeof data.timezone === "object" ? String(data.timezone?.id || "") : String(data.timezone || ""),
      updatedAt: Date.now()
    };
  }

  const COUNTRY_LOCALES = Object.freeze({
    AE: "ar-AE", AR: "es-AR", AT: "de-AT", AU: "en-AU", BD: "bn-BD", BE: "nl-BE", BG: "bg-BG",
    BR: "pt-BR", CA: "en-CA", CH: "de-CH", CL: "es-CL", CN: "zh-CN", CO: "es-CO", CZ: "cs-CZ",
    DE: "de-DE", DK: "da-DK", EG: "ar-EG", ES: "es-ES", FI: "fi-FI", FR: "fr-FR", GB: "en-GB",
    GR: "el-GR", HK: "zh-HK", HU: "hu-HU", ID: "id-ID", IE: "en-IE", IL: "he-IL", IN: "hi-IN",
    IT: "it-IT", JP: "ja-JP", KE: "en-KE", KR: "ko-KR", MO: "zh-MO", MX: "es-MX", MY: "ms-MY",
    NG: "en-NG", NL: "nl-NL", NO: "nb-NO", NZ: "en-NZ", PH: "en-PH", PK: "ur-PK", PL: "pl-PL",
    PT: "pt-PT", RO: "ro-RO", RU: "ru-RU", SA: "ar-SA", SE: "sv-SE", SG: "en-SG", TH: "th-TH",
    TR: "tr-TR", TW: "zh-TW", UA: "uk-UA", US: "en-US", VN: "vi-VN", ZA: "en-ZA"
  });

  const CHINESE_FONTS = Object.freeze([
    "Microsoft YaHei", "Microsoft YaHei UI", "SimSun", "NSimSun", "SimHei", "FangSong", "KaiTi", "DengXian",
    "PingFang SC", "PingFang TC", "Hiragino Sans GB", "STHeiti", "STSong", "MiSans", "HarmonyOS Sans",
    "HarmonyOS Sans SC", "OPPO Sans", "Noto Sans CJK SC", "Noto Serif CJK SC", "Source Han Sans CN",
    "Source Han Serif CN", "WenQuanYi Micro Hei"
  ]);

  function localeForCountry(countryCode) {
    const code = String(countryCode || "").toUpperCase();
    if (COUNTRY_LOCALES[code]) return COUNTRY_LOCALES[code];
    if (/^[A-Z]{2}$/.test(code)) {
      try {
        const likely = new Intl.Locale(`und-${code}`).maximize();
        return new Intl.Locale(`${likely.language}-${code}`).toString();
      } catch {}
    }
    return "en-US";
  }

  function validateLocale(locale) {
    const value = String(locale || "").trim();
    if (!value) throw new Error("请输入语言代码，例如 en-US");
    try { return new Intl.Locale(value).toString(); }
    catch { throw new Error("语言代码无效，请使用 en-US、ja-JP 这类格式"); }
  }

  function validateTimeZone(timeZone) {
    const value = String(timeZone || "").trim();
    if (!value) throw new Error("请输入 IANA 时区，例如 America/New_York");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return value;
    } catch { throw new Error("时区无效，请使用 America/New_York、Asia/Tokyo 这类格式"); }
  }

  function fontProfile(locale, countryCode) {
    const language = String(locale || "en-US").split("-")[0].toLowerCase();
    const isChineseRegion = ["CN", "HK", "MO", "TW"].includes(String(countryCode || "").toUpperCase());
    const profiles = {
      zh: { fallback: "Microsoft YaHei", reported: ["Microsoft YaHei", "SimSun", "DengXian", "Arial", "Times New Roman"] },
      ja: { fallback: "Yu Gothic", reported: ["Yu Gothic", "Meiryo", "Arial", "Times New Roman"] },
      ko: { fallback: "Malgun Gothic", reported: ["Malgun Gothic", "Arial", "Times New Roman"] },
      ar: { fallback: "Tahoma", reported: ["Tahoma", "Arial", "Traditional Arabic", "Times New Roman"] },
      th: { fallback: "Leelawadee UI", reported: ["Leelawadee UI", "Tahoma", "Arial"] },
      hi: { fallback: "Nirmala UI", reported: ["Nirmala UI", "Mangal", "Arial"] }
    };
    const selected = profiles[language] || { fallback: "Arial", reported: ["Arial", "Times New Roman", "Segoe UI", "Tahoma", "Calibri"] };
    return {
      fontFallback: selected.fallback,
      reportedFonts: selected.reported,
      hiddenFonts: isChineseRegion || language === "zh" ? [] : [...CHINESE_FONTS]
    };
  }

  function buildEnvironmentProfile(location, settings, mode) {
    const manual = mode === "manual";
    const coordinates = manual ? validateManualLocation(settings) : {
      latitude: Number(location?.latitude),
      longitude: Number(location?.longitude),
      accuracy: Number(location?.accuracy) || 25000,
      label: String(location?.label || "IP 估算位置")
    };
    const countryCode = manual
      ? String(settings.manualCountryCode || "").trim().toUpperCase()
      : String(location?.countryCode || "").trim().toUpperCase();
    if (manual && countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw new Error("国家代码必须是两位字母，例如 US、JP");
    const locale = manual
      ? validateLocale(settings.manualLocale || localeForCountry(countryCode))
      : localeForCountry(countryCode);
    const timeZone = settings.matchTimezone === false
      ? ""
      : (manual ? validateTimeZone(settings.manualTimezone) : validateTimeZone(location?.timezone));
    const languages = [locale];
    return {
      enabled: true,
      mode,
      ...coordinates,
      ip: String(location?.ip || ""),
      country: String(location?.country || ""),
      countryCode,
      city: String(location?.city || ""),
      locale,
      languages,
      timeZone,
      timezoneEnabled: settings.matchTimezone !== false,
      languageEnabled: settings.matchLanguage !== false,
      fontPrivacyMode: ["off", "balanced", "strict"].includes(settings.fontPrivacyMode) ? settings.fontPrivacyMode : "strict",
      ...fontProfile(locale, countryCode),
      updatedAt: Date.now()
    };
  }

  return {
    normalizeGroups,
    setNodeFavorite,
    removeFavoriteGroup,
    filterNodes,
    validateManualLocation,
    normalizeGeoResponse,
    localeForCountry,
    validateLocale,
    validateTimeZone,
    fontProfile,
    buildEnvironmentProfile
  };
});
