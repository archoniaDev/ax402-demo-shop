import type { Env } from "./env";
import { publicBase } from "./env";
import { loadAbout, publicAbout, saveAbout } from "./about";
import {
  MAGIC_LINK_TTL_S,
  SESSION_TTL_S,
  clearSessionCookie,
  getSession,
  hashToken,
  isUniqueViolation,
  normalizeEmail,
  nowS,
  randomToken,
  sessionCookie,
  unauthorized,
} from "./auth";
import { TX_HASH_RE, obtainQuote, verifyPayment } from "./ax402";
import {
  type AlbumRow,
  type TrackRow,
  listPublicCatalog,
  slugify,
  validatePrice,
} from "./catalog";
import {
  createDownloadTokens,
  downloadLinksForTokens,
  serveCover,
  serveDownload,
} from "./downloads";
import { contactConfig, submitContact } from "./contact";
import { sendDownloadEmail, sendResendEmail } from "./email";
import { json, methodNotAllowed, readJson } from "./http";
import {
  assertPayoutConfigured,
  loadOrder,
  paymentRequiredResponse,
  publicOrder,
  resolveCartItems,
  type CartLineIn,
  type OrderRow,
} from "./orders";
import { cacheCoverToR2, resolveSpotifyCoverUrl } from "./spotify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LIVE_LINKS = 3;
const AUDIO_MAX_BYTES = 200 * 1024 * 1024;
const COVER_MAX_BYTES = 5 * 1024 * 1024;

export async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (path === "/api/health") {
    return json(200, {
      ok: true,
      service: "ax402-demo-shop",
      bindings: { db: Boolean(env.DB), audio: Boolean(env.AUDIO), assets: Boolean(env.ASSETS) },
    });
  }

  if (path === "/api/catalog") {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "sv";
    return json(200, await listPublicCatalog(env, locale));
  }

  if (path === "/api/about") {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    if (!env.DB) return json(200, publicAbout(null));
    try {
      return json(200, publicAbout(await loadAbout(env)));
    } catch (err) {
      console.warn("about_load_failed", err);
      return json(200, publicAbout(null));
    }
  }

  if (path === "/api/contact") {
    if (method === "GET") return contactConfig(env);
    if (method === "POST") return submitContact(request, env);
    return methodNotAllowed(["GET", "POST"]);
  }

  if (path.startsWith("/api/covers/")) {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const albumId = decodeURIComponent(path.slice("/api/covers/".length));
    return serveCover(env, albumId);
  }

  if (path === "/api/download") {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const token = new URL(request.url).searchParams.get("token") ?? "";
    return serveDownload(env, token);
  }

  if (path === "/api/orders") {
    if (method === "POST") return createOrder(request, env);
    return methodNotAllowed(["POST"]);
  }

  const orderMatch = path.match(/^\/api\/orders\/([^/]+)(?:\/(pay))?$/);
  if (orderMatch) {
    const orderId = decodeURIComponent(orderMatch[1]);
    const action = orderMatch[2];
    if (action === "pay") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return payOrder(request, env, ctx, orderId);
    }
    if (method === "GET") return getOrder(request, env, orderId);
    return methodNotAllowed(["GET"]);
  }

  if (path === "/api/auth/request-link") {
    if (method !== "POST") return methodNotAllowed(["POST"]);
    return requestMagicLink(request, env);
  }
  if (path === "/api/auth/callback") {
    if (method !== "POST") return methodNotAllowed(["POST"]);
    return authCallback(request, env);
  }
  if (path === "/api/auth/logout") {
    if (method !== "POST") return methodNotAllowed(["POST"]);
    return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie(request) });
  }
  if (path === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const session = await getSession(request, env);
    if (!session) return unauthorized();
    return json(200, { email: session.owner.email });
  }

  if (path.startsWith("/api/admin/")) {
    const session = await getSession(request, env);
    if (!session) return unauthorized();
    return handleAdmin(request, env, path, method);
  }

  return json(404, { error: "not_found", path });
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json(503, { error: "database_unavailable" });
  const mis = assertPayoutConfigured(env);
  if (mis) return mis;

  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });

  const emailRaw = body.buyer_email;
  if (typeof emailRaw !== "string" || !EMAIL_RE.test(emailRaw.trim()) || emailRaw.length > 200) {
    return json(400, { error: "buyer_email_required" });
  }
  const buyerEmail = emailRaw.trim().toLowerCase();

  let locale = env.DEFAULT_LOCALE === "en" ? "en" : "sv";
  if (body.locale !== undefined) {
    if (body.locale !== "en" && body.locale !== "sv") return json(400, { error: "locale_invalid" });
    locale = body.locale;
  }

  const lines = body.items as CartLineIn[] | undefined;
  const resolved = await resolveCartItems(env, Array.isArray(lines) ? lines : []);
  if (!resolved.ok) return json(400, { error: resolved.error });

  const quote = await obtainQuote(env, { sku: resolved.sku, amount_usdc: resolved.amount });
  if (!quote.ok) return json(503, { error: quote.error, detail: quote.detail });

  const order: OrderRow = {
    id: crypto.randomUUID(),
    locale,
    status: "pending_payment",
    buyer_email: buyerEmail,
    items_json: JSON.stringify(resolved.items),
    amount_usdc: resolved.amount,
    quote_id: quote.quote_id,
    payment_tx_hash: null,
    ax402_order_id: null,
    created_at: nowS(),
    updated_at: nowS(),
  };

  await env.DB.prepare(
    `INSERT INTO orders (id, locale, status, buyer_email, items_json, amount_usdc, quote_id)
     VALUES (?, ?, 'pending_payment', ?, ?, ?, ?)`,
  )
    .bind(order.id, order.locale, order.buyer_email, order.items_json, order.amount_usdc, order.quote_id)
    .run();

  return paymentRequiredResponse(env, order);
}

async function getOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const row = await loadOrder(env, orderId);
  if (!row) return json(404, { error: "order_not_found" });
  // Public GET does not re-mint tokens; client keeps download URLs from pay response / email.
  return json(200, publicOrder(env, row));
}

async function payOrder(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  orderId: string,
): Promise<Response> {
  if (!env.DB) return json(503, { error: "database_unavailable" });

  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });
  const raw = (body.payment_data as { hash?: unknown } | undefined)?.hash;
  const hash = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!TX_HASH_RE.test(hash)) {
    return json(400, { error: "invalid_hash", detail: "payment_data.hash must be 0x + 64 hex chars" });
  }

  const row = await loadOrder(env, orderId);
  if (!row) return json(404, { error: "order_not_found" });

  if (row.status !== "pending_payment") {
    if (row.status !== "canceled" && row.payment_tx_hash === hash) {
      return json(200, { ...publicOrder(env, row), already_paid: true });
    }
    return json(409, { error: "order_not_payable", detail: `order is ${row.status}`, status: row.status });
  }

  // Block paying from the band payout wallet (same-account).
  // We cannot always know the sender here; client-side usdc-pay.js enforces it for wallet path.

  const taken = await env.DB.prepare("SELECT id FROM orders WHERE payment_tx_hash = ?")
    .bind(hash)
    .first();
  if (taken) {
    return json(409, { error: "payment_already_used", detail: "this transaction hash already paid an order" });
  }

  const verified = await verifyPayment(env, row, hash);
  if (!verified.ok) {
    return json(verified.status, { error: verified.error, detail: verified.detail, status: "pending_payment" });
  }

  try {
    const res = await env.DB.prepare(
      `UPDATE orders
       SET status = 'paid', payment_tx_hash = ?, ax402_order_id = ?, updated_at = strftime('%s', 'now')
       WHERE id = ? AND status = 'pending_payment'`,
    )
      .bind(hash, verified.ax402_order_id, row.id)
      .run();
    if (!res.meta?.changes) {
      return json(409, { error: "order_not_payable", detail: "order changed state during verification" });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return json(409, { error: "payment_already_used", detail: "this transaction hash already paid an order" });
    }
    throw err;
  }

  let items = [];
  try {
    items = JSON.parse(row.items_json);
  } catch {
    items = [];
  }

  const tokens = await createDownloadTokens(env, row.id, items);
  const base = publicBase(env, request);
  const downloads = downloadLinksForTokens(base, tokens, row.locale === "en" ? "en" : "sv");

  if (row.buyer_email && downloads.length >= 0) {
    ctx.waitUntil(
      sendDownloadEmail(env, {
        to: row.buyer_email,
        orderId: row.id,
        links: downloads,
        locale: row.locale === "en" ? "en" : "sv",
      }).then(async (ok) => {
        if (ok) {
          await env.DB.prepare(
            `UPDATE orders SET status = 'fulfilled', updated_at = strftime('%s', 'now')
             WHERE id = ? AND status = 'paid'`,
          )
            .bind(row.id)
            .run();
        }
      }),
    );
  }

  const updated = await loadOrder(env, row.id);
  return json(200, {
    ...publicOrder(env, updated!, downloads),
    verify_mode: verified.mode,
    downloads,
  });
}

async function requestMagicLink(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json(503, { error: "database_unavailable" });
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json(400, { error: "invalid_email" });

  const devReturn = env.MAGIC_LINK_DEV_RETURN === "true";
  const resendReady = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
  if (!devReturn && !resendReady) {
    return json(503, { error: "email_not_configured" });
  }

  const bootstrap = normalizeEmail(env.OWNER_BOOTSTRAP_EMAIL);
  let owner = await env.DB.prepare("SELECT id FROM owners WHERE email = ?").bind(email).first<{ id: string }>();
  if (!owner && bootstrap && email === bootstrap) {
    const id = `own-${randomToken(8)}`;
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, email) VALUES (?, ?)").bind(id, email).run();
    owner = await env.DB.prepare("SELECT id FROM owners WHERE email = ?").bind(email).first<{ id: string }>();
  }

  const generic = { ok: true };
  if (!owner) return json(200, generic);

  const now = nowS();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();

  const live = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sessions WHERE owner_id = ? AND magic_token_hash IS NOT NULL",
  )
    .bind(owner.id)
    .first<{ n: number }>();
  if ((live?.n ?? 0) >= MAX_LIVE_LINKS) return json(200, generic);

  const token = randomToken(32);
  await env.DB.prepare(
    "INSERT INTO sessions (id, owner_id, magic_token_hash, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(`ses-${randomToken(8)}`, owner.id, await hashToken(env, token), now + MAGIC_LINK_TTL_S)
    .run();

  const base = publicBase(env, request);
  const link = `${base}/admin/auth/callback/?token=${token}`;

  if (devReturn) return json(200, { ...generic, dev_magic_link: link });

  const sent = await sendResendEmail(env, {
    to: email,
    subject: "Archonia Verify Demo Shop admin sign-in link",
    text: `Sign in to Archonia Verify Demo Shop admin:\n\n${link}\n\nThis link expires in ${MAGIC_LINK_TTL_S / 60} minutes and can be used once. If you did not request it, ignore this email.`,
  });
  if (!sent) return json(502, { error: "email_send_failed" });
  return json(200, generic);
}

async function authCallback(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json(503, { error: "database_unavailable" });
  const body = await readJson(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { error: "invalid_token" });

  const sessionToken = randomToken(32);
  const now = nowS();
  const row = await env.DB.prepare(
    `UPDATE sessions
     SET magic_token_hash = NULL, session_token_hash = ?, expires_at = ?
     WHERE magic_token_hash = ? AND expires_at > ?
     RETURNING owner_id`,
  )
    .bind(await hashToken(env, sessionToken), now + SESSION_TTL_S, await hashToken(env, token), now)
    .first<{ owner_id: string }>();

  if (!row) return json(401, { error: "invalid_or_expired_token" });

  const owner = await env.DB.prepare("SELECT email FROM owners WHERE id = ?")
    .bind(row.owner_id)
    .first<{ email: string }>();
  return json(
    200,
    { ok: true, email: owner?.email ?? null },
    { "Set-Cookie": sessionCookie(request, sessionToken) },
  );
}

async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
  method: string,
): Promise<Response> {
  if (path === "/api/admin/orders") {
    if (method !== "GET") return methodNotAllowed(["GET"]);
    const { results } = await env.DB.prepare(
      `SELECT id, locale, status, buyer_email, amount_usdc, payment_tx_hash, created_at, updated_at
       FROM orders ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json(200, results ?? []);
  }

  if (path === "/api/admin/about") {
    if (method === "GET") {
      try {
        const row = await loadAbout(env);
        return json(200, row ?? { ...publicAbout(null), id: 1, updated_at: null });
      } catch (err) {
        console.warn("about_admin_load_failed", err);
        return json(200, { ...publicAbout(null), id: 1, updated_at: null });
      }
    }
    if (method === "PUT" || method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json(400, { error: "invalid_json" });
      try {
        const saved = await saveAbout(env, {
          title_sv: body.title_sv as string | undefined,
          title_en: body.title_en as string | undefined,
          lede_sv: body.lede_sv as string | undefined,
          lede_en: body.lede_en as string | undefined,
          body_sv: body.body_sv as string | undefined,
          body_en: body.body_en as string | undefined,
        });
        return json(200, saved);
      } catch (err) {
        console.error("about_save_failed", err);
        return json(500, { error: "about_save_failed", detail: "Apply D1 migration 0005_about_content if missing." });
      }
    }
    return methodNotAllowed(["GET", "PUT", "PATCH"]);
  }

  if (path === "/api/admin/albums") {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, slug, title_sv, title_en, description_sv, description_en, price_usdc,
                cover_r2_key, cover_url, spotify_url, sort_order, active, created_at, updated_at
         FROM albums ORDER BY sort_order ASC, slug ASC`,
      ).all();
      return json(200, results ?? []);
    }
    if (method === "POST") return createAlbum(request, env);
    return methodNotAllowed(["GET", "POST"]);
  }

  const albumMatch = path.match(/^\/api\/admin\/albums\/([^/]+)(?:\/(cover))?$/);
  if (albumMatch) {
    const id = decodeURIComponent(albumMatch[1]);
    if (albumMatch[2] === "cover") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return uploadCover(request, env, id);
    }
    if (method === "PATCH") return patchAlbum(request, env, id);
    if (method === "DELETE") return softDeleteAlbum(env, id);
    return methodNotAllowed(["PATCH", "DELETE"]);
  }

  if (path === "/api/admin/tracks") {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, album_id, slug, title_sv, title_en, price_usdc, format, r2_key, cover_url, spotify_url,
                duration_sec, track_number, sort_order, active, created_at, updated_at
         FROM tracks ORDER BY sort_order ASC, track_number ASC, slug ASC`,
      ).all();
      return json(200, results ?? []);
    }
    if (method === "POST") return createTrack(request, env);
    return methodNotAllowed(["GET", "POST"]);
  }

  const trackMatch = path.match(/^\/api\/admin\/tracks\/([^/]+)(?:\/(audio))?$/);
  if (trackMatch) {
    const id = decodeURIComponent(trackMatch[1]);
    if (trackMatch[2] === "audio") {
      if (method !== "POST") return methodNotAllowed(["POST"]);
      return uploadAudio(request, env, id);
    }
    if (method === "PATCH") return patchTrack(request, env, id);
    if (method === "DELETE") return hardDeleteTrack(env, id);
    return methodNotAllowed(["PATCH", "DELETE"]);
  }

  return json(404, { error: "not_found", path });
}

async function createAlbum(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });
  const title_sv = str(body.title_sv, 200);
  const title_en = str(body.title_en, 200);
  if (!title_sv || !title_en) return json(400, { error: "title_required" });
  const price = validatePrice(body.price_usdc ?? "10.00");
  if (!price) return json(400, { error: "price_invalid" });
  const slug = str(body.slug, 80) || slugify(title_en);
  const id = `alb-${randomToken(6)}`;
  const spotify = optionalUrl(body.spotify_url);
  try {
    await env.DB.prepare(
      `INSERT INTO albums (id, slug, title_sv, title_en, description_sv, description_en, price_usdc, spotify_url, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        slug,
        title_sv,
        title_en,
        str(body.description_sv, 2000) ?? "",
        str(body.description_en, 2000) ?? "",
        price,
        spotify,
        num(body.sort_order) ?? 0,
        body.active === false || body.active === 0 ? 0 : 1,
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return json(409, { error: "slug_taken" });
    throw err;
  }
  await syncAlbumSpotifyCover(env, id, spotify, null, null);
  const row = await env.DB.prepare(`SELECT * FROM albums WHERE id = ?`).bind(id).first();
  return json(201, row);
}

async function patchAlbum(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT * FROM albums WHERE id = ?`).bind(id).first<AlbumRow>();
  if (!existing) return json(404, { error: "album_not_found" });
  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });

  const title_sv = body.title_sv !== undefined ? str(body.title_sv, 200) : existing.title_sv;
  const title_en = body.title_en !== undefined ? str(body.title_en, 200) : existing.title_en;
  if (!title_sv || !title_en) return json(400, { error: "title_required" });
  let price = existing.price_usdc;
  if (body.price_usdc !== undefined) {
    const p = validatePrice(body.price_usdc);
    if (!p) return json(400, { error: "price_invalid" });
    price = p;
  }
  const slug = body.slug !== undefined ? str(body.slug, 80) || existing.slug : existing.slug;
  const spotify =
    body.spotify_url !== undefined ? optionalUrl(body.spotify_url) : existing.spotify_url;
  const active =
    body.active !== undefined ? (body.active === false || body.active === 0 ? 0 : 1) : existing.active;
  const sort_order = body.sort_order !== undefined ? (num(body.sort_order) ?? existing.sort_order) : existing.sort_order;

  try {
    await env.DB.prepare(
      `UPDATE albums SET slug = ?, title_sv = ?, title_en = ?, description_sv = ?, description_en = ?,
        price_usdc = ?, spotify_url = ?, sort_order = ?, active = ?, updated_at = strftime('%s', 'now')
       WHERE id = ?`,
    )
      .bind(
        slug,
        title_sv,
        title_en,
        body.description_sv !== undefined ? str(body.description_sv, 2000) ?? "" : existing.description_sv,
        body.description_en !== undefined ? str(body.description_en, 2000) ?? "" : existing.description_en,
        price,
        spotify,
        sort_order,
        active,
        id,
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return json(409, { error: "slug_taken" });
    throw err;
  }
  if (body.spotify_url !== undefined) {
    await syncAlbumSpotifyCover(env, id, spotify, existing.spotify_url, existing.cover_r2_key);
  }
  return json(200, await env.DB.prepare(`SELECT * FROM albums WHERE id = ?`).bind(id).first());
}

async function softDeleteAlbum(env: Env, id: string): Promise<Response> {
  const res = await env.DB.prepare(
    `UPDATE albums SET active = 0, updated_at = strftime('%s', 'now') WHERE id = ?`,
  )
    .bind(id)
    .run();
  if (!res.meta?.changes) return json(404, { error: "album_not_found" });
  return json(200, { ok: true });
}

async function createTrack(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });
  const title_sv = str(body.title_sv, 200);
  const title_en = str(body.title_en, 200);
  if (!title_sv || !title_en) return json(400, { error: "title_required" });
  const price = validatePrice(body.price_usdc ?? "0.90");
  if (!price) return json(400, { error: "price_invalid" });
  const format = body.format === "wav" ? "wav" : "flac";
  const slug = str(body.slug, 80) || slugify(title_en);
  const album_id = typeof body.album_id === "string" && body.album_id ? body.album_id : null;
  if (album_id) {
    const a = await env.DB.prepare(`SELECT id FROM albums WHERE id = ?`).bind(album_id).first();
    if (!a) return json(400, { error: "album_not_found" });
  }
  const id = `trk-${randomToken(6)}`;
  const spotify = optionalUrl(body.spotify_url);
  try {
    await env.DB.prepare(
      `INSERT INTO tracks (id, album_id, slug, title_sv, title_en, price_usdc, format, spotify_url,
                           duration_sec, track_number, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        album_id,
        slug,
        title_sv,
        title_en,
        price,
        format,
        spotify,
        num(body.duration_sec),
        num(body.track_number) ?? 0,
        num(body.sort_order) ?? 0,
        body.active === false || body.active === 0 ? 0 : 1,
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return json(409, { error: "slug_taken" });
    throw err;
  }
  await syncTrackSpotifyCover(env, id, spotify, null);
  return json(201, await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(id).first());
}

async function patchTrack(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(id).first<TrackRow>();
  if (!existing) return json(404, { error: "track_not_found" });
  const body = await readJson(request);
  if (!body) return json(400, { error: "invalid_json" });

  const title_sv = body.title_sv !== undefined ? str(body.title_sv, 200) : existing.title_sv;
  const title_en = body.title_en !== undefined ? str(body.title_en, 200) : existing.title_en;
  if (!title_sv || !title_en) return json(400, { error: "title_required" });
  let price = existing.price_usdc;
  if (body.price_usdc !== undefined) {
    const p = validatePrice(body.price_usdc);
    if (!p) return json(400, { error: "price_invalid" });
    price = p;
  }
  const format = body.format === "wav" || body.format === "flac" ? body.format : existing.format;
  const slug = body.slug !== undefined ? str(body.slug, 80) || existing.slug : existing.slug;
  let album_id = existing.album_id;
  if (body.album_id !== undefined) {
    album_id = typeof body.album_id === "string" && body.album_id ? body.album_id : null;
    if (album_id) {
      const a = await env.DB.prepare(`SELECT id FROM albums WHERE id = ?`).bind(album_id).first();
      if (!a) return json(400, { error: "album_not_found" });
    }
  }
  const spotify =
    body.spotify_url !== undefined ? optionalUrl(body.spotify_url) : existing.spotify_url;
  const active =
    body.active !== undefined ? (body.active === false || body.active === 0 ? 0 : 1) : existing.active;

  try {
    await env.DB.prepare(
      `UPDATE tracks SET album_id = ?, slug = ?, title_sv = ?, title_en = ?, price_usdc = ?, format = ?,
        spotify_url = ?, duration_sec = ?, track_number = ?, sort_order = ?, active = ?,
        updated_at = strftime('%s', 'now')
       WHERE id = ?`,
    )
      .bind(
        album_id,
        slug,
        title_sv,
        title_en,
        price,
        format,
        spotify,
        body.duration_sec !== undefined ? num(body.duration_sec) : existing.duration_sec,
        body.track_number !== undefined ? (num(body.track_number) ?? 0) : existing.track_number,
        body.sort_order !== undefined ? (num(body.sort_order) ?? 0) : existing.sort_order,
        active,
        id,
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return json(409, { error: "slug_taken" });
    throw err;
  }
  if (body.spotify_url !== undefined) {
    await syncTrackSpotifyCover(env, id, spotify, existing.spotify_url);
  }
  return json(200, await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(id).first());
}

/**
 * Hard-delete a catalog track. Soft-blocks when non-canceled orders or download
 * tokens still reference it so paid history / R2 fulfillment stay intact.
 * download_tokens.track_id is ON DELETE SET NULL, but we refuse instead of
 * orphaning live downloads. Order items_json is left untouched when blocked.
 */
async function hardDeleteTrack(env: Env, id: string): Promise<Response> {
  const track = await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(id).first<TrackRow>();
  if (!track) return json(404, { error: "track_not_found" });

  const tokenHit = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM download_tokens WHERE track_id = ?`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((tokenHit?.n ?? 0) > 0) {
    return json(409, {
      error: "track_has_orders",
      detail:
        "This track has download tokens from paid orders. Deactivate it instead, or keep it for fulfillment history.",
    });
  }

  // items_json shape: {"kind":"track","id":"<id>",...} — refuse live cart/order refs.
  const orderHit = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM orders
     WHERE status IN ('pending_payment', 'paid', 'fulfilled')
       AND items_json LIKE '%"kind":"track","id":"' || ? || '"%'`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((orderHit?.n ?? 0) > 0) {
    return json(409, {
      error: "track_has_orders",
      detail:
        "This track is referenced by an open or paid order. Deactivate it instead of deleting.",
    });
  }

  if (track.r2_key && env.AUDIO) {
    try {
      await env.AUDIO.delete(track.r2_key);
    } catch (err) {
      console.warn("track_r2_delete_failed", id, track.r2_key, err);
      return json(502, {
        error: "r2_delete_failed",
        detail: "Could not remove the audio object from R2; track was not deleted.",
      });
    }
  }

  const res = await env.DB.prepare(`DELETE FROM tracks WHERE id = ?`).bind(id).run();
  if (!res.meta?.changes) return json(404, { error: "track_not_found" });
  return json(200, { ok: true, deleted: id });
}

async function uploadAudio(request: Request, env: Env, trackId: string): Promise<Response> {
  const track = await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(trackId).first<TrackRow>();
  if (!track) return json(404, { error: "track_not_found" });

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json(400, { error: "multipart_required" });
  }
  const form = await request.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) return json(400, { error: "audio_required" });
  if (file.size <= 0 || file.size > AUDIO_MAX_BYTES) {
    return json(400, { error: "audio_too_large", detail: `max ${AUDIO_MAX_BYTES} bytes` });
  }

  const name = file.name.toLowerCase();
  let format = track.format;
  if (name.endsWith(".wav")) format = "wav";
  else if (name.endsWith(".flac")) format = "flac";
  else if (!name.endsWith(".flac") && !name.endsWith(".wav")) {
    return json(400, { error: "audio_format", detail: "only .flac or .wav" });
  }

  const key = `audio/${trackId}/${Date.now()}-${safeName(file.name)}`;
  await env.AUDIO.put(key, file.stream(), {
    httpMetadata: { contentType: format === "wav" ? "audio/wav" : "audio/flac" },
  });
  await env.DB.prepare(
    `UPDATE tracks SET r2_key = ?, format = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
  )
    .bind(key, format, trackId)
    .run();

  return json(200, await env.DB.prepare(`SELECT * FROM tracks WHERE id = ?`).bind(trackId).first());
}

async function uploadCover(request: Request, env: Env, albumId: string): Promise<Response> {
  const album = await env.DB.prepare(`SELECT id FROM albums WHERE id = ?`).bind(albumId).first();
  if (!album) return json(404, { error: "album_not_found" });

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json(400, { error: "multipart_required" });
  }
  const form = await request.formData();
  const file = form.get("image") ?? form.get("cover");
  if (!(file instanceof File)) return json(400, { error: "image_required" });
  if (file.size <= 0 || file.size > COVER_MAX_BYTES) {
    return json(400, { error: "image_too_large" });
  }
  const mime = file.type || "image/jpeg";
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) {
    return json(400, { error: "image_type" });
  }
  const key = `covers/${albumId}/${Date.now()}-${safeName(file.name)}`;
  await env.AUDIO.put(key, file.stream(), { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    `UPDATE albums SET cover_r2_key = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
  )
    .bind(key, albumId)
    .run();
  return json(200, await env.DB.prepare(`SELECT * FROM albums WHERE id = ?`).bind(albumId).first());
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function optionalUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, 500);
  if (/^https?:\/\//i.test(s)) return s;
  if (/^spotify:(album|track):[a-zA-Z0-9]+$/i.test(s)) return s;
  return null;
}

/**
 * When admin sets/clears Spotify URL: resolve cover via Web API, store cover_url,
 * and mirror album art into R2 when there is no manual cover yet.
 */
async function syncAlbumSpotifyCover(
  env: Env,
  albumId: string,
  spotify: string | null,
  previousSpotify: string | null,
  existingCoverR2: string | null,
): Promise<void> {
  if (spotify === previousSpotify) return;

  if (!spotify) {
    await env.DB.prepare(
      `UPDATE albums SET cover_url = NULL, updated_at = strftime('%s', 'now') WHERE id = ?`,
    )
      .bind(albumId)
      .run();
    return;
  }

  const resolved = await resolveSpotifyCoverUrl(env, spotify);
  if (resolved.error === "spotify_not_configured") {
    console.warn("spotify_cover_skipped", albumId, resolved.error);
    return;
  }
  const coverUrl = resolved.coverUrl;
  await env.DB.prepare(
    `UPDATE albums SET cover_url = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
  )
    .bind(coverUrl, albumId)
    .run();

  if (coverUrl && !existingCoverR2) {
    const key = await cacheCoverToR2(env, coverUrl, `covers/${albumId}`);
    if (key) {
      await env.DB.prepare(
        `UPDATE albums SET cover_r2_key = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
      )
        .bind(key, albumId)
        .run();
    }
  }
}

async function syncTrackSpotifyCover(
  env: Env,
  trackId: string,
  spotify: string | null,
  previousSpotify: string | null,
): Promise<void> {
  if (spotify === previousSpotify) return;

  if (!spotify) {
    await env.DB.prepare(
      `UPDATE tracks SET cover_url = NULL, updated_at = strftime('%s', 'now') WHERE id = ?`,
    )
      .bind(trackId)
      .run();
    return;
  }

  const resolved = await resolveSpotifyCoverUrl(env, spotify);
  if (resolved.error === "spotify_not_configured") {
    console.warn("spotify_cover_skipped", trackId, resolved.error);
    return;
  }
  await env.DB.prepare(
    `UPDATE tracks SET cover_url = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
  )
    .bind(resolved.coverUrl, trackId)
    .run();
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}
