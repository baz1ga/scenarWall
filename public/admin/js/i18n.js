const cache = new Map();

// Charge un namespace de locale (JSON) avec fallback en (en).
export async function loadLocale(lang = "fr", namespace = "common") {
  const key = `${lang}:${namespace}`;
  if (cache.has(key)) return cache.get(key);

  async function fetchLocale(code) {
    try {
      const res = await fetch(`/locales/${code}/${namespace}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  let data = await fetchLocale(lang);
  if (!data && lang !== "en") data = await fetchLocale("en");
  const dict = data || {};
  cache.set(key, dict);
  return dict;
}

// Récupère une clé dans le dictionnaire avec fallback.
export function t(dict = {}, key = "", fallback = "") {
  if (!key) return fallback || "";
  const parts = key.split(".");
  let cur = dict;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      cur = undefined;
      break;
    }
  }
  if (cur === undefined || cur === null) return fallback || key;
  if (typeof cur === "string" || typeof cur === "number") return cur;
  return fallback || key;
}
