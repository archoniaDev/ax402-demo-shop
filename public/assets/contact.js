/**
 * Archonia Verify Demo Shop contact form — Turnstile (explicit render) + POST /api/contact.
 */
(() => {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let widgetId;
  let siteKey = "";
  let submitting = false;

  function t(key, fallback) {
    return window.AxShop?.t?.(key) ?? fallback ?? key;
  }

  function setMsg(el, kind, text) {
    if (!el) return;
    el.className = kind ? `msg ${kind}` : "msg";
    el.textContent = text || "";
  }

  function resetTurnstile() {
    try {
      if (widgetId !== undefined && window.turnstile?.reset) {
        window.turnstile.reset(widgetId);
      }
    } catch {
      /* ignore */
    }
  }

  function renderTurnstile() {
    const slot = document.getElementById("contact-turnstile");
    if (!slot || !siteKey || !window.turnstile?.render) return;
    if (widgetId !== undefined) return;
    widgetId = window.turnstile.render(slot, {
      sitekey: siteKey,
      action: "contact",
      theme: "light",
    });
  }

  window.onAxShopTurnstileLoad = () => {
    renderTurnstile();
  };

  function loadTurnstileScript() {
    if (document.querySelector('script[data-axshop-turnstile]')) return;
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onAxShopTurnstileLoad&render=explicit";
    s.async = true;
    s.defer = true;
    s.dataset.axshopTurnstile = "1";
    document.head.appendChild(s);
  }

  async function loadConfig() {
    const res = await fetch("/api/contact", { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    const data = await res.json();
    siteKey = typeof data.turnstile_site_key === "string" ? data.turnstile_site_key.trim() : "";
    if (!siteKey) throw new Error("no_sitekey");
    loadTurnstileScript();
    if (window.turnstile) renderTurnstile();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const form = event.currentTarget;
    const msgEl = document.getElementById("contact-msg");
    const submitBtn = document.getElementById("contact-submit");
    const name = String(form.name?.value || "").trim();
    const email = String(form.email?.value || "").trim();
    const message = String(form.message?.value || "").trim();
    const company = String(form.company?.value || "").trim();

    if (!name) {
      setMsg(msgEl, "err", t("contact.err_name", "Enter your name."));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setMsg(msgEl, "err", t("contact.err_email", "Enter a valid email."));
      return;
    }
    if (message.length < 10) {
      setMsg(msgEl, "err", t("contact.err_message", "Write a short message (at least 10 characters)."));
      return;
    }

    let token = "";
    try {
      if (widgetId !== undefined && window.turnstile?.getResponse) {
        token = window.turnstile.getResponse(widgetId) || "";
      }
    } catch {
      token = "";
    }
    if (!token) {
      setMsg(msgEl, "err", t("contact.err_turnstile", "Complete the bot check, then try again."));
      return;
    }

    submitting = true;
    if (submitBtn) submitBtn.disabled = true;
    setMsg(msgEl, "", t("contact.sending", "Sending…"));

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          message,
          company,
          locale: window.AxShop?.lang === "en" ? "en" : "sv",
          "cf-turnstile-response": token,
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (res.ok && data.ok) {
        form.reset();
        setMsg(msgEl, "ok", t("contact.ok", "Message sent. Thanks — we will reply by email."));
        return;
      }

      const err = data.error || "";
      if (res.status === 429 || err === "rate_limited") {
        setMsg(msgEl, "err", t("contact.err_rate", "Too many messages. Try again in a few minutes."));
      } else if (res.status === 403 || err === "turnstile_failed") {
        setMsg(msgEl, "err", t("contact.err_turnstile", "Complete the bot check, then try again."));
      } else if (res.status === 503 || err === "unavailable") {
        setMsg(msgEl, "err", t("contact.err_unavailable", "Contact is not configured yet. Try again later."));
      } else if (err === "email_invalid") {
        setMsg(msgEl, "err", t("contact.err_email", "Enter a valid email."));
      } else if (err === "message_required") {
        setMsg(msgEl, "err", t("contact.err_message", "Write a short message (at least 10 characters)."));
      } else {
        setMsg(msgEl, "err", t("contact.err_send", "Could not send. Please try again."));
      }
    } catch {
      setMsg(msgEl, "err", t("contact.err_send", "Could not send. Please try again."));
    } finally {
      submitting = false;
      if (submitBtn) submitBtn.disabled = false;
      resetTurnstile();
    }
  }

  async function init() {
    const form = document.getElementById("contact-form");
    if (!form) return;
    form.addEventListener("submit", onSubmit);
    document.addEventListener("axshop-lang", () => {
      /* placeholders re-applied by site.js; keep status text as-is */
    });
    try {
      await loadConfig();
    } catch (err) {
      console.warn("AxShop contact Turnstile config failed", err);
      setMsg(
        document.getElementById("contact-msg"),
        "err",
        t("contact.err_unavailable", "Contact is not configured yet. Try again later."),
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
