/**
 * Overlay About page copy from GET /api/about onto i18n keys.
 * Empty/missing API fields leave the static /i18n/*.json defaults in place.
 */
(() => {
  const KEYS = ["title", "lede", "body"];

  function mapLocale(data, locale) {
    /** @type {Record<string, string>} */
    const partial = {};
    for (const key of KEYS) {
      const value = data[`${key}_${locale}`];
      if (typeof value === "string" && value.trim()) {
        partial[`about.${key}`] = value.trim();
      }
    }
    // Keep document title in sync with About title when present.
    const title = partial["about.title"];
    if (title) partial["meta.about.title"] = `${title} — Archonia Verify Demo Shop`;
    return partial;
  }

  async function waitForAxShop(ms = 4000) {
    const start = Date.now();
    while (!window.AxShop?.mergeDict) {
      if (Date.now() - start > ms) return null;
      await new Promise((r) => setTimeout(r, 30));
    }
    return window.AxShop;
  }

  async function run() {
    let data = null;
    try {
      const res = await fetch("/api/about", { cache: "no-cache" });
      if (res.ok) data = await res.json();
    } catch (err) {
      console.warn("AxShop about API failed", err);
      return;
    }
    if (!data) return;

    const shop = await waitForAxShop();
    if (!shop) return;

    // Ensure both locale dicts are loaded before merging so lang toggle keeps overlays.
    try {
      await shop.setLang(shop.lang);
    } catch {
      /* site.js already warned */
    }

    shop.mergeDict("sv", mapLocale(data, "sv"));
    shop.mergeDict("en", mapLocale(data, "en"));
    shop.apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      run();
    });
  } else {
    run();
  }
})();
