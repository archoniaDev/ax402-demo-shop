/**
 * Shop + cart badge rendering.
 */
(() => {
  async function loadCatalog() {
    const lang = window.AxShop?.lang || "sv";
    const res = await fetch(`/api/catalog?locale=${lang}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    return res.json();
  }

  function t(key, fallback) {
    return window.AxShop?.t?.(key) ?? fallback ?? key;
  }

  function money(amount) {
    return `${amount} USDC`;
  }

  function ensureToastHost() {
    let host = document.querySelector("[data-toast-host]");
    if (host) return host;
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("data-toast-host", "");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
    return host;
  }

  function showToast(message) {
    const host = ensureToastHost();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    host.append(el);
    window.setTimeout(() => {
      el.classList.add("is-out");
      window.setTimeout(() => el.remove(), 280);
    }, 1600);
  }

  function confirmAdd(btn, { already } = {}) {
    const prev = btn.dataset.label || btn.textContent;
    btn.dataset.label = prev;
    btn.classList.add("is-added");
    btn.textContent = already
      ? t("shop.in_cart", "In cart")
      : t("shop.added", "Added");
    showToast(
      already
        ? t("shop.in_cart_toast", "Already in cart")
        : t("shop.added_toast", "Added to cart"),
    );
    window.clearTimeout(btn._addedTimer);
    btn._addedTimer = window.setTimeout(() => {
      btn.textContent = btn.dataset.label || prev;
      btn.classList.remove("is-added");
    }, 1400);
  }

  function addToCart(btn, item) {
    const before = window.AxShopCart?.count?.() ?? 0;
    window.AxShopCart.add(item);
    const after = window.AxShopCart?.count?.() ?? 0;
    updateBadge();
    confirmAdd(btn, { already: after === before });
  }

  function albumCoverUrl(album) {
    if (album.cover_url) return album.cover_url;
    const track = (album.tracks || []).find((tr) => tr.cover_url);
    return track?.cover_url || null;
  }

  function renderCatalog(root, data) {
    root.replaceChildren();
    if (!data.albums?.length && !data.tracks?.length) {
      const p = document.createElement("p");
      p.className = "placeholder";
      p.textContent = t("shop.empty", "No releases yet.");
      root.append(p);
      return;
    }

    for (const album of data.albums || []) {
      const section = document.createElement("section");
      section.className = "catalog-block";

      const layout = document.createElement("div");
      const coverUrl = albumCoverUrl(album);
      layout.className = coverUrl ? "catalog-album has-cover" : "catalog-album";

      if (coverUrl) {
        const cover = document.createElement("img");
        cover.className = "catalog-cover";
        cover.src = coverUrl;
        cover.alt = "";
        cover.loading = "lazy";
        cover.decoding = "async";
        cover.width = 160;
        cover.height = 160;
        layout.append(cover);
      }

      const body = document.createElement("div");
      body.className = "catalog-album-body";

      const head = document.createElement("div");
      head.className = "catalog-head";

      const headMain = document.createElement("div");
      headMain.className = "catalog-head-main";
      const h2 = document.createElement("h2");
      h2.textContent = album.title;
      const meta = document.createElement("p");
      meta.className = "catalog-meta";
      meta.textContent = money(album.price_usdc);
      headMain.append(h2, meta);

      const actions = document.createElement("div");
      actions.className = "row-actions";
      const addAlbum = document.createElement("button");
      addAlbum.type = "button";
      addAlbum.className = "btn";
      addAlbum.textContent = t("shop.add_album", "Add album");
      addAlbum.addEventListener("click", () => {
        addToCart(addAlbum, { kind: "album", id: album.id });
      });
      actions.append(addAlbum);
      if (album.spotify_url) {
        const sp = document.createElement("a");
        sp.href = album.spotify_url;
        sp.target = "_blank";
        sp.rel = "noopener";
        sp.className = "text-link";
        sp.textContent = "Spotify";
        actions.append(sp);
      }
      head.append(headMain, actions);
      body.append(head);

      if (album.description) {
        const d = document.createElement("p");
        d.className = "lede";
        d.textContent = album.description;
        body.append(d);
      }

      layout.append(body);
      section.append(layout);

      const list = document.createElement("ul");
      list.className = "track-list";
      for (const track of album.tracks || []) {
        const li = document.createElement("li");
        const left = document.createElement("div");
        left.className = "track-left";
        if (track.cover_url) {
          const thumb = document.createElement("img");
          thumb.className = "track-cover";
          thumb.src = track.cover_url;
          thumb.alt = "";
          thumb.loading = "lazy";
          thumb.decoding = "async";
          thumb.width = 96;
          thumb.height = 96;
          left.append(thumb);
        }
        const num = document.createElement("span");
        num.className = "track-num";
        num.textContent = String(track.track_number || "·").padStart(2, "0");
        const title = document.createElement("span");
        title.className = "track-title";
        title.append(document.createTextNode(track.title));
        if (!track.downloadable) {
          const soon = document.createElement("span");
          soon.className = "badge";
          soon.textContent = t("shop.coming_soon", "audio soon");
          title.append(" ", soon);
        }
        left.append(num, title);
        const right = document.createElement("div");
        right.className = "row-actions";
        const price = document.createElement("span");
        price.className = "mono";
        price.textContent = money(track.price_usdc);
        const add = document.createElement("button");
        add.type = "button";
        add.className = "btn btn-ghost";
        add.textContent = t("shop.add_track", "Add");
        add.addEventListener("click", () => {
          addToCart(add, { kind: "track", id: track.id });
        });
        right.append(price, add);
        if (track.spotify_url) {
          const sp = document.createElement("a");
          sp.href = track.spotify_url;
          sp.target = "_blank";
          sp.rel = "noopener";
          sp.className = "text-link";
          sp.textContent = "♪";
          sp.title = "Spotify";
          right.append(sp);
        }
        li.append(left, right);
        list.append(li);
      }
      if ((album.tracks || []).length) section.append(list);
      root.append(section);
    }

    if (data.tracks?.length) {
      const section = document.createElement("section");
      section.className = "catalog-block";
      const h2 = document.createElement("h2");
      h2.textContent = t("shop.singles", "Singles / EP");
      section.append(h2);
      const list = document.createElement("ul");
      list.className = "track-list singles";
      for (const track of data.tracks) {
        const li = document.createElement("li");
        const left = document.createElement("div");
        left.className = "track-left";
        if (track.cover_url) {
          const thumb = document.createElement("img");
          thumb.className = "track-cover";
          thumb.src = track.cover_url;
          thumb.alt = "";
          thumb.loading = "lazy";
          thumb.decoding = "async";
          thumb.width = 112;
          thumb.height = 112;
          left.append(thumb);
        }
        const title = document.createElement("span");
        title.className = "track-title";
        title.append(document.createTextNode(track.title));
        if (!track.downloadable) {
          const soon = document.createElement("span");
          soon.className = "badge";
          soon.textContent = t("shop.coming_soon", "audio soon");
          title.append(" ", soon);
        }
        left.append(title);
        const right = document.createElement("div");
        right.className = "row-actions";
        const price = document.createElement("span");
        price.className = "mono";
        price.textContent = money(track.price_usdc);
        const add = document.createElement("button");
        add.type = "button";
        add.className = "btn btn-ghost";
        add.textContent = t("shop.add_track", "Add");
        add.addEventListener("click", () => {
          addToCart(add, { kind: "track", id: track.id });
        });
        right.append(price, add);
        if (track.spotify_url) {
          const sp = document.createElement("a");
          sp.href = track.spotify_url;
          sp.target = "_blank";
          sp.rel = "noopener";
          sp.className = "text-link";
          sp.textContent = "♪";
          sp.title = "Spotify";
          right.append(sp);
        }
        li.append(left, right);
        list.append(li);
      }
      section.append(list);
      root.append(section);
    }
  }

  function updateBadge() {
    const n = window.AxShopCart?.count?.() ?? 0;
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  async function initShop() {
    updateBadge();
    window.addEventListener("axshop-cart", updateBadge);
    const root = document.querySelector("[data-catalog]");
    if (!root) return;
    try {
      const data = await loadCatalog();
      renderCatalog(root, data);
    } catch (err) {
      root.textContent = t("shop.error", "Could not load catalog.");
      console.warn(err);
    }
    // Re-render on language toggle (site.js dispatches axshop-lang after apply)
    document.addEventListener("axshop-lang", async () => {
      try {
        renderCatalog(root, await loadCatalog());
      } catch {
        /* keep current catalog */
      }
    });
  }

  window.AxShopShop = { initShop, loadCatalog, updateBadge };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // wait a tick for site.js i18n
      setTimeout(initShop, 0);
    });
  } else {
    setTimeout(initShop, 0);
  }
})();
