const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && path.startsWith("/api/admin")) {
    showLogin();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`);
  return data;
}

const jsonOpts = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
}
function showApp(email) {
  $("login").hidden = true;
  $("app").hidden = false;
  $("who").textContent = email;
}

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.getAttribute("data-tab");
    ["tracks", "albums", "orders", "about"].forEach((name) => {
      $(`tab-${name}`).hidden = name !== tab;
    });
    if (tab === "orders") loadOrders().catch((e) => setMsg($("album-msg"), e.message, "err"));
    if (tab === "about") loadAbout().catch((e) => setMsg($("about-msg"), e.message, "err"));
  });
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("login-msg"), "Sending…");
  $("dev-link").hidden = true;
  try {
    const data = await api("/api/auth/request-link", jsonOpts("POST", { email: $("email").value }));
    setMsg($("login-msg"), "If that email belongs to an owner, a sign-in link is on its way.", "ok");
    if (data.dev_magic_link) {
      const a = document.createElement("a");
      a.href = data.dev_magic_link;
      a.textContent = "Dev sign-in link";
      $("dev-link").replaceChildren(a);
      $("dev-link").hidden = false;
    }
  } catch (err) {
    setMsg($("login-msg"), err.message, "err");
  }
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  showLogin();
});

function resetTrackForm() {
  $("track-form").reset();
  $("t-id").value = "";
  $("t-price").value = "0.90";
  $("t-active").checked = true;
  $("track-form-title").textContent = "New track";
  $("t-cancel").hidden = true;
}
$("t-cancel").addEventListener("click", () => {
  resetTrackForm();
  setMsg($("track-msg"), "");
});

function editTrack(t) {
  $("t-id").value = t.id;
  $("t-title-sv").value = t.title_sv;
  $("t-title-en").value = t.title_en;
  $("t-price").value = t.price_usdc;
  $("t-format").value = t.format;
  $("t-album").value = t.album_id || "";
  $("t-spotify").value = t.spotify_url || "";
  $("t-number").value = t.track_number;
  $("t-sort").value = t.sort_order;
  $("t-active").checked = !!t.active;
  $("t-audio").value = "";
  $("track-form-title").textContent = "Edit: " + t.title_en;
  $("t-cancel").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("track-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("track-msg"), "Saving…");
  try {
    const id = $("t-id").value;
    const body = {
      title_sv: $("t-title-sv").value,
      title_en: $("t-title-en").value,
      price_usdc: $("t-price").value,
      format: $("t-format").value,
      album_id: $("t-album").value.trim() || null,
      spotify_url: $("t-spotify").value.trim() || null,
      track_number: Number($("t-number").value || 0),
      sort_order: Number($("t-sort").value || 0),
      active: $("t-active").checked,
    };
    const saved = await api(
      id ? `/api/admin/tracks/${id}` : "/api/admin/tracks",
      jsonOpts(id ? "PATCH" : "POST", body),
    );
    const file = $("t-audio").files[0];
    if (file) {
      const fd = new FormData();
      fd.append("audio", file);
      await api(`/api/admin/tracks/${saved.id}/audio`, { method: "POST", body: fd });
    }
    resetTrackForm();
    setMsg($("track-msg"), "Saved.", "ok");
    await loadTracks();
  } catch (err) {
    setMsg($("track-msg"), err.message, "err");
  }
});

async function loadTracks() {
  const tracks = await api("/api/admin/tracks");
  const list = $("track-list");
  list.replaceChildren();
  if (!tracks.length) {
    list.textContent = "No tracks yet.";
    return;
  }
  for (const t of tracks) {
    const row = document.createElement("div");
    row.className = "item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t.title_en;
    if (!t.active) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "inactive";
      title.append(b);
    }
    if (t.r2_key) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "audio";
      title.append(b);
    }
    if (t.cover_url) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "cover";
      title.append(b);
    }
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.textContent = `${t.title_sv} · $${t.price_usdc} · ${t.slug}${t.spotify_url ? " · Spotify" : ""}`;
    info.append(title, sub);
    const actions = document.createElement("div");
    actions.className = "row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editTrack(t));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = t.active ? "Deactivate" : "Activate";
    if (t.active) toggle.className = "danger";
    toggle.addEventListener("click", async () => {
      await api(`/api/admin/tracks/${t.id}`, jsonOpts("PATCH", { active: !t.active }));
      await loadTracks();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      const label = t.title_en || t.slug || t.id;
      if (!confirm(`Permanently delete "${label}"? This removes the track and its audio file. This cannot be undone.`)) {
        return;
      }
      try {
        setMsg($("track-msg"), "Deleting…");
        await api(`/api/admin/tracks/${encodeURIComponent(t.id)}`, { method: "DELETE" });
        if ($("t-id").value === t.id) resetTrackForm();
        setMsg($("track-msg"), "Deleted.", "ok");
        await loadTracks();
      } catch (err) {
        setMsg($("track-msg"), err.message, "err");
      }
    });
    actions.append(edit, toggle, del);
    row.append(info, actions);
    list.append(row);
  }
}

function resetAlbumForm() {
  $("album-form").reset();
  $("a-id").value = "";
  $("a-price").value = "10.00";
  $("a-active").checked = true;
  $("album-form-title").textContent = "New album";
  $("a-cancel").hidden = true;
}
$("a-cancel").addEventListener("click", () => {
  resetAlbumForm();
  setMsg($("album-msg"), "");
});

function editAlbum(a) {
  $("a-id").value = a.id;
  $("a-title-sv").value = a.title_sv;
  $("a-title-en").value = a.title_en;
  $("a-desc-sv").value = a.description_sv || "";
  $("a-desc-en").value = a.description_en || "";
  $("a-price").value = a.price_usdc;
  $("a-spotify").value = a.spotify_url || "";
  $("a-active").checked = !!a.active;
  $("a-cover").value = "";
  $("album-form-title").textContent = "Edit: " + a.title_en;
  $("a-cancel").hidden = false;
}

$("album-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("album-msg"), "Saving…");
  try {
    const id = $("a-id").value;
    const body = {
      title_sv: $("a-title-sv").value,
      title_en: $("a-title-en").value,
      description_sv: $("a-desc-sv").value,
      description_en: $("a-desc-en").value,
      price_usdc: $("a-price").value,
      spotify_url: $("a-spotify").value.trim() || null,
      active: $("a-active").checked,
    };
    const saved = await api(
      id ? `/api/admin/albums/${id}` : "/api/admin/albums",
      jsonOpts(id ? "PATCH" : "POST", body),
    );
    const file = $("a-cover").files[0];
    if (file) {
      const fd = new FormData();
      fd.append("image", file);
      await api(`/api/admin/albums/${saved.id}/cover`, { method: "POST", body: fd });
    }
    resetAlbumForm();
    setMsg($("album-msg"), "Saved.", "ok");
    await loadAlbums();
  } catch (err) {
    setMsg($("album-msg"), err.message, "err");
  }
});

async function loadAlbums() {
  const albums = await api("/api/admin/albums");
  const list = $("album-list");
  list.replaceChildren();
  if (!albums.length) {
    list.textContent = "No albums yet.";
    return;
  }
  for (const a of albums) {
    const row = document.createElement("div");
    row.className = "item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${a.title_en} (${a.id})`;
    if (!a.active) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "inactive";
      title.append(b);
    }
    if (a.cover_r2_key || a.cover_url) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "cover";
      title.append(b);
    }
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.textContent = `$${a.price_usdc} · ${a.slug}${a.spotify_url ? " · Spotify" : ""}`;
    info.append(title, sub);
    const actions = document.createElement("div");
    actions.className = "row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editAlbum(a));
    actions.append(edit);
    row.append(info, actions);
    list.append(row);
  }
}

async function loadOrders() {
  const orders = await api("/api/admin/orders");
  const list = $("order-list");
  list.replaceChildren();
  if (!orders.length) {
    list.textContent = "No orders yet.";
    return;
  }
  for (const o of orders) {
    const row = document.createElement("div");
    row.className = "item";
    const info = document.createElement("div");
    info.innerHTML = `<strong class="mono">${o.id.slice(0, 8)}</strong> · ${o.status} · $${o.amount_usdc}<div class="muted">${o.buyer_email} · ${new Date(o.created_at * 1000).toISOString()}</div>`;
    list.append(row);
    row.append(info);
  }
}

async function loadAbout() {
  const about = await api("/api/admin/about");
  $("about-title-sv").value = about.title_sv || "";
  $("about-title-en").value = about.title_en || "";
  $("about-lede-sv").value = about.lede_sv || "";
  $("about-lede-en").value = about.lede_en || "";
  $("about-body-sv").value = about.body_sv || "";
  $("about-body-en").value = about.body_en || "";
  setMsg($("about-msg"), "");
}

$("about-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg($("about-msg"), "Saving…");
  try {
    await api(
      "/api/admin/about",
      jsonOpts("PUT", {
        title_sv: $("about-title-sv").value,
        title_en: $("about-title-en").value,
        lede_sv: $("about-lede-sv").value,
        lede_en: $("about-lede-en").value,
        body_sv: $("about-body-sv").value,
        body_en: $("about-body-en").value,
      }),
    );
    setMsg($("about-msg"), "Saved. Public /about/ will use this copy.", "ok");
  } catch (err) {
    setMsg($("about-msg"), err.message, "err");
  }
});

(async () => {
  try {
    const me = await api("/api/auth/me");
    showApp(me.email);
    await loadTracks();
    await loadAlbums();
  } catch {
    showLogin();
  }
})();
