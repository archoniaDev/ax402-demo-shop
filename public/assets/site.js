/**
 * Ax402 Demo Shop public shell — SV/EN toggle + mobile nav.
 * Language preference is persisted immediately (localStorage + cookie)
 * so a follow-up navigation cannot lose the choice mid-fetch.
 */
(() => {
  const STORAGE_KEY = "axshop-lang";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
  const SUPPORTED = ["sv", "en"];

  /** @type {Record<string, Record<string, string>>} */
  const cache = {};

  function readCookie() {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${STORAGE_KEY}=([a-z]+)`),
    );
    return match?.[1] || null;
  }

  function persist(locale) {
    if (!SUPPORTED.includes(locale)) return;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* private mode / blocked */
    }
    try {
      document.cookie = `${STORAGE_KEY}=${locale};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }

  function detect() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch {
      /* ignore */
    }
    const fromCookie = readCookie();
    if (fromCookie && SUPPORTED.includes(fromCookie)) return fromCookie;
    const nav = (navigator.language || "sv").toLowerCase();
    return nav.startsWith("en") ? "en" : "sv";
  }

  /** @type {string} */
  let lang = detect();
  persist(lang);

  async function load(locale) {
    if (cache[locale]) return cache[locale];
    const res = await fetch(`/i18n/${locale}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`i18n ${locale}: ${res.status}`);
    cache[locale] = await res.json();
    return cache[locale];
  }

  function t(key) {
    const dict = cache[lang] || {};
    return dict[key] ?? cache.en?.[key] ?? key;
  }

  function paintChrome() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
      btn.textContent = lang === "sv" ? "EN" : "SV";
      btn.setAttribute(
        "aria-label",
        lang === "sv" ? "Switch to English" : "Byt till svenska",
      );
    });
  }

  function apply() {
    paintChrome();
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const value = t(key);
      if (el.tagName === "TITLE" || el.dataset.i18nAttr === "title") {
        document.title = value;
      }
      if (el.tagName !== "TITLE") el.textContent = value;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    persist(lang);
    document.dispatchEvent(
      new CustomEvent("axshop-lang", { detail: { lang } }),
    );
  }

  async function setLang(next) {
    if (!SUPPORTED.includes(next)) return;
    // Persist before any await so a quick page navigation cannot drop the choice.
    lang = next;
    persist(next);
    paintChrome();
    await load(next);
    if (!cache.en) await load("en").catch(() => {});
    apply();
  }

  /** Merge non-empty strings into a locale dict (e.g. About copy from D1). */
  function mergeDict(locale, partial) {
    if (!SUPPORTED.includes(locale) || !partial || typeof partial !== "object") return;
    if (!cache[locale]) cache[locale] = {};
    for (const [key, value] of Object.entries(partial)) {
      if (typeof value === "string" && value.trim()) cache[locale][key] = value;
    }
    if (lang === locale) apply();
  }

  function initNavToggle() {
    document.querySelectorAll("[data-nav-toggle]").forEach((btn) => {
      const root = btn.closest(".page-strip-top, .hero-topbar, .topbar");
      if (!root) return;
      const nav = root.querySelector("nav");
      if (!nav) return;

      const setOpen = (open) => {
        root.classList.toggle("is-nav-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("nav-open", open);
      };

      btn.addEventListener("click", () => {
        setOpen(!root.classList.contains("is-nav-open"));
      });

      nav.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => setOpen(false));
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setOpen(false);
      });

      window.addEventListener("resize", () => {
        if (window.matchMedia("(min-width: 761px)").matches) setOpen(false);
      });
    });
  }

  async function init() {
    paintChrome();
    try {
      await load(lang);
      if (lang !== "en") await load("en").catch(() => {});
      apply();
    } catch (err) {
      console.warn("AxShop i18n failed", err);
    }
    document.querySelectorAll("[data-lang-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void setLang(lang === "sv" ? "en" : "sv");
      });
    });
    initNavToggle();
  }

  window.AxShop = {
    get lang() {
      return lang;
    },
    t,
    setLang,
    mergeDict,
    apply,
    init,
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
