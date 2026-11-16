(() => {
  const TX_RE = /^0x[a-fA-F0-9]{64}$/;

  function t(key, fallback) {
    return window.AxShop?.t?.(key) ?? fallback ?? key;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  async function resolveTitles(items) {
    const lang = window.AxShop?.lang || "sv";
    const cat = await fetch(`/api/catalog?locale=${lang}`).then((r) => r.json());
    const map = new Map();
    for (const a of cat.albums || []) {
      map.set(`album:${a.id}`, { title: a.title, price: a.price_usdc });
      for (const tr of a.tracks || []) {
        map.set(`track:${tr.id}`, { title: tr.title, price: tr.price_usdc });
      }
    }
    for (const tr of cat.tracks || []) {
      map.set(`track:${tr.id}`, { title: tr.title, price: tr.price_usdc });
    }
    return items.map((i) => {
      const meta = map.get(`${i.kind}:${i.id}`);
      return { ...i, title: meta?.title || i.id, price: meta?.price || "?" };
    });
  }

  function renderCart(lines) {
    const list = $("[data-cart-list]");
    const totalEl = $("[data-cart-total]");
    if (!list) return;
    list.replaceChildren();
    if (!lines.length) {
      list.textContent = t("checkout.empty", "Cart is empty.");
      if (totalEl) totalEl.textContent = "";
      return;
    }
    let cents = 0;
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "cart-row";
      const title = document.createElement("span");
      title.textContent = `${line.kind === "album" ? "Album" : "Track"} · ${line.title}`;
      const price = document.createElement("span");
      price.className = "mono";
      price.textContent = `${line.price} USDC`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-ghost";
      rm.textContent = t("checkout.remove", "Remove");
      rm.addEventListener("click", () => {
        window.AxShopCart.remove(line);
        boot();
      });
      row.append(title, price, rm);
      list.append(row);
      const [w, f = ""] = String(line.price).split(".");
      cents += Number(w || 0) * 100 + Number((f + "00").slice(0, 2));
    }
    if (totalEl) {
      totalEl.textContent = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")} USDC`;
    }
  }

  function showWalletHelp(show) {
    const el = $("#wallet-help");
    if (el) el.hidden = !show;
  }

  async function submitPay(hash, orderId) {
    const res = await fetch(`/api/orders/${orderId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_data: { hash } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `pay ${res.status}`);
    return data;
  }

  function goOrder(orderId, payData) {
    window.AxShopCart.clear();
    if (payData?.downloads) {
      sessionStorage.setItem(`axshop-dl-${orderId}`, JSON.stringify(payData.downloads));
    }
    location.href = `/order/?id=${encodeURIComponent(orderId)}`;
  }

  async function createOrder() {
    const email = $("#buyer-email")?.value?.trim();
    if (!email) throw new Error(t("checkout.email_required", "Email is required for delivery."));
    const items = window.AxShopCart.read();
    if (!items.length) throw new Error(t("checkout.empty", "Cart is empty."));
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer_email: email,
        locale: window.AxShop?.lang || "sv",
        items,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 402) {
      throw new Error(data.detail || data.error || `order ${res.status}`);
    }
    return data;
  }

  async function onWalletPay() {
    const msg = $("[data-checkout-msg]");
    setMsg(msg, t("checkout.working", "Working…"));
    try {
      showWalletHelp(!window.ethereum);
      if (!window.ethereum) {
        setMsg(msg, t("order.pay.nowallet", "No browser wallet detected."), "err");
        return;
      }
      const payment = await createOrder();
      const hash = await window.AxShopPay.payWithInjectedWallet({
        recipient: payment.recipient_address,
        amount: payment.amount,
      });
      const paid = await submitPay(hash, payment.order_id);
      goOrder(payment.order_id, paid);
    } catch (err) {
      if (err?.message === "NO_WALLET") {
        showWalletHelp(true);
        setMsg(msg, t("order.pay.nowallet", "No browser wallet detected."), "err");
      } else {
        setMsg(msg, err.message || String(err), "err");
      }
    }
  }

  async function onPastePay() {
    const msg = $("[data-checkout-msg]");
    const hash = $("#tx-hash")?.value?.trim();
    if (!TX_RE.test(hash || "")) {
      setMsg(msg, t("checkout.bad_hash", "Enter a valid 0x… transaction hash."), "err");
      return;
    }
    setMsg(msg, t("checkout.working", "Working…"));
    try {
      const payment = await createOrder();
      const paid = await submitPay(hash, payment.order_id);
      goOrder(payment.order_id, paid);
    } catch (err) {
      setMsg(msg, err.message || String(err), "err");
    }
  }

  async function boot() {
    showWalletHelp(!window.ethereum);
    const items = window.AxShopCart.read();
    try {
      const lines = await resolveTitles(items);
      renderCart(lines);
    } catch {
      renderCart(items.map((i) => ({ ...i, title: i.id, price: "?" })));
    }
    const payBtn = $("#pay-wallet");
    const pasteBtn = $("#pay-paste");
    if (payBtn && !payBtn.dataset.bound) {
      payBtn.dataset.bound = "1";
      payBtn.addEventListener("click", onWalletPay);
    }
    if (pasteBtn && !pasteBtn.dataset.bound) {
      pasteBtn.dataset.bound = "1";
      pasteBtn.addEventListener("click", onPastePay);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
  } else {
    setTimeout(boot, 0);
  }
})();
