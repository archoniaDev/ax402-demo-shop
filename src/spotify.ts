/**
 * Spotify Web API — Client Credentials (cover art only).
 * Secrets: SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (free Developer Dashboard app).
 */

import type { Env } from "./env";

export type SpotifyResource =
  | { kind: "album"; id: string }
  | { kind: "track"; id: string };

type TokenCache = { accessToken: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

const OPEN_RE =
  /^https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(album|track)\/([a-zA-Z0-9]+)(?:[/?#]|$)/i;
const URI_RE = /^spotify:(album|track):([a-zA-Z0-9]+)$/i;
const ID_RE = /^[a-zA-Z0-9]{22}$/;

export function parseSpotifyUrl(raw: string | null | undefined): SpotifyResource | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const uri = URI_RE.exec(s);
  if (uri) return { kind: uri[1].toLowerCase() as "album" | "track", id: uri[2] };

  const open = OPEN_RE.exec(s);
  if (open) return { kind: open[1].toLowerCase() as "album" | "track", id: open[2] };

  return null;
}

function spotifyConfigured(env: Env): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
}

async function getAccessToken(env: Env): Promise<string | null> {
  if (!spotifyConfigured(env)) return null;
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return tokenCache.accessToken;
  }

  const id = env.SPOTIFY_CLIENT_ID!.trim();
  const secret = env.SPOTIFY_CLIENT_SECRET!.trim();
  const basic = btoa(`${id}:${secret}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.warn("spotify_token_failed", res.status);
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  tokenCache = {
    accessToken: data.access_token,
    expiresAtMs: now + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  };
  return data.access_token;
}

type SpotifyImage = { url?: string; height?: number | null; width?: number | null };

function pickLargestImage(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort(
    (a, b) => (Number(b.height) || 0) - (Number(a.height) || 0),
  );
  const url = sorted[0]?.url?.trim();
  return url && /^https:\/\//i.test(url) ? url : null;
}

/**
 * Resolve cover image URL for an open.spotify.com album/track link.
 * Returns null when secrets missing, URL invalid, or Spotify has no art.
 */
export async function resolveSpotifyCoverUrl(
  env: Env,
  spotifyUrl: string | null | undefined,
): Promise<{ coverUrl: string | null; resource: SpotifyResource | null; error?: string }> {
  const resource = parseSpotifyUrl(spotifyUrl ?? null);
  if (!spotifyUrl?.trim()) return { coverUrl: null, resource: null };
  if (!resource) return { coverUrl: null, resource: null, error: "spotify_url_invalid" };
  if (!ID_RE.test(resource.id)) {
    return { coverUrl: null, resource, error: "spotify_id_invalid" };
  }
  if (!spotifyConfigured(env)) {
    return { coverUrl: null, resource, error: "spotify_not_configured" };
  }

  const token = await getAccessToken(env);
  if (!token) return { coverUrl: null, resource, error: "spotify_token_failed" };

  const path =
    resource.kind === "album"
      ? `https://api.spotify.com/v1/albums/${resource.id}`
      : `https://api.spotify.com/v1/tracks/${resource.id}`;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { coverUrl: null, resource, error: "spotify_not_found" };
  if (!res.ok) {
    console.warn("spotify_lookup_failed", resource.kind, res.status);
    return { coverUrl: null, resource, error: "spotify_lookup_failed" };
  }

  const data = (await res.json()) as {
    images?: SpotifyImage[];
    album?: { images?: SpotifyImage[] };
  };
  const images = resource.kind === "album" ? data.images : data.album?.images;
  const coverUrl = pickLargestImage(images);
  if (!coverUrl) return { coverUrl: null, resource, error: "spotify_no_image" };
  return { coverUrl, resource };
}

/**
 * Download Spotify CDN image into private R2 and return the object key.
 * Best-effort: returns null on failure (caller still keeps cover_url).
 */
export async function cacheCoverToR2(
  env: Env,
  coverUrl: string,
  prefix: string,
): Promise<string | null> {
  try {
    const res = await fetch(coverUrl, { redirect: "follow" });
    if (!res.ok || !res.body) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!/^image\//i.test(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength <= 0 || buf.byteLength > 5 * 1024 * 1024) return null;
    const ext =
      ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
    const key = `${prefix}/${Date.now()}-spotify.${ext}`;
    await env.AUDIO.put(key, buf, { httpMetadata: { contentType: ct } });
    return key;
  } catch (err) {
    console.warn("spotify_r2_cache_failed", err);
    return null;
  }
}
