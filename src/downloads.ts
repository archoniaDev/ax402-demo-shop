import type { Env } from "./env";
import { hashToken, nowS, randomToken } from "./auth";
import type { TrackRow } from "./catalog";

export const DOWNLOAD_TTL_S = 7 * 24 * 60 * 60;
export const DOWNLOAD_MAX_USES = 5;

export type OrderItem = {
  kind: "track" | "album";
  id: string;
  slug: string;
  title_sv: string;
  title_en: string;
  price_usdc: string;
};

export type CreatedToken = {
  id: string;
  track_id: string | null;
  album_id: string | null;
  r2_key: string;
  raw_token: string;
  title_sv: string;
  title_en: string;
  expires_at: number;
};

/**
 * After payment: mint download tokens for every R2 object in the order.
 * Album lines expand to all tracks with r2_key; tracks without audio are skipped.
 */
export async function createDownloadTokens(
  env: Env,
  orderId: string,
  items: OrderItem[],
): Promise<CreatedToken[]> {
  const created: CreatedToken[] = [];
  const expiresAt = nowS() + DOWNLOAD_TTL_S;

  for (const item of items) {
    let tracks: TrackRow[] = [];
    if (item.kind === "track") {
      const t = await env.DB.prepare(
        `SELECT id, album_id, slug, title_sv, title_en, price_usdc, format, r2_key, spotify_url,
                duration_sec, track_number, sort_order, active
         FROM tracks WHERE id = ?`,
      )
        .bind(item.id)
        .first<TrackRow>();
      if (t) tracks = [t];
    } else {
      const res = await env.DB.prepare(
        `SELECT id, album_id, slug, title_sv, title_en, price_usdc, format, r2_key, spotify_url,
                duration_sec, track_number, sort_order, active
         FROM tracks WHERE album_id = ? AND active = 1 AND r2_key IS NOT NULL
         ORDER BY sort_order ASC, track_number ASC`,
      )
        .bind(item.id)
        .all<TrackRow>();
      tracks = res.results ?? [];
    }

    for (const t of tracks) {
      if (!t.r2_key) continue;
      const raw = randomToken(32);
      const id = `dl-${randomToken(8)}`;
      await env.DB.prepare(
        `INSERT INTO download_tokens
           (id, order_id, track_id, album_id, token_hash, r2_key, expires_at, max_uses, use_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
        .bind(
          id,
          orderId,
          t.id,
          t.album_id,
          await hashToken(env, raw),
          t.r2_key,
          expiresAt,
          DOWNLOAD_MAX_USES,
        )
        .run();
      created.push({
        id,
        track_id: t.id,
        album_id: t.album_id,
        r2_key: t.r2_key,
        raw_token: raw,
        title_sv: t.title_sv,
        title_en: t.title_en,
        expires_at: expiresAt,
      });
    }
  }

  return created;
}

export function downloadLinksForTokens(
  baseUrl: string,
  tokens: CreatedToken[],
  locale: string,
): { title: string; url: string; expires_at: number }[] {
  return tokens.map((t) => ({
    title: locale === "en" ? t.title_en : t.title_sv,
    url: `${baseUrl.replace(/\/+$/, "")}/api/download?token=${t.raw_token}`,
    expires_at: t.expires_at,
  }));
}

export async function serveDownload(env: Env, rawToken: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) {
    return new Response("Invalid token", { status: 400 });
  }
  const hash = await hashToken(env, rawToken);
  const row = await env.DB.prepare(
    `SELECT id, r2_key, expires_at, max_uses, use_count FROM download_tokens WHERE token_hash = ?`,
  )
    .bind(hash)
    .first<{ id: string; r2_key: string; expires_at: number; max_uses: number; use_count: number }>();

  if (!row) return new Response("Not found", { status: 404 });
  if (row.expires_at <= nowS()) return new Response("Link expired", { status: 410 });
  if (row.use_count >= row.max_uses) return new Response("Download limit reached", { status: 410 });

  const updated = await env.DB.prepare(
    `UPDATE download_tokens SET use_count = use_count + 1
     WHERE id = ? AND use_count < max_uses AND expires_at > ?`,
  )
    .bind(row.id, nowS())
    .run();
  if (!updated.meta?.changes) return new Response("Download limit reached", { status: 410 });

  const obj = await env.AUDIO.get(row.r2_key);
  if (!obj) return new Response("File missing", { status: 404 });

  const filename = row.r2_key.split("/").pop() || "shop-download";
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "no-store");
  headers.set("content-disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  if (!headers.has("content-type")) {
    headers.set("content-type", guessAudioType(filename));
  }

  return new Response(obj.body, { status: 200, headers });
}

function guessAudioType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

export async function serveCover(env: Env, albumId: string): Promise<Response> {
  const album = await env.DB.prepare(`SELECT cover_r2_key FROM albums WHERE id = ? AND active = 1`)
    .bind(albumId)
    .first<{ cover_r2_key: string | null }>();
  if (!album?.cover_r2_key) return new Response("Not found", { status: 404 });
  const obj = await env.AUDIO.get(album.cover_r2_key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  if (!headers.has("content-type")) headers.set("content-type", "image/jpeg");
  return new Response(obj.body, { status: 200, headers });
}
