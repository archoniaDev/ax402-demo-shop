import type { Env } from "./env";

export type AlbumRow = {
  id: string;
  slug: string;
  title_sv: string;
  title_en: string;
  description_sv: string;
  description_en: string;
  price_usdc: string;
  cover_r2_key: string | null;
  cover_url: string | null;
  spotify_url: string | null;
  sort_order: number;
  active: number;
};

export type TrackRow = {
  id: string;
  album_id: string | null;
  slug: string;
  title_sv: string;
  title_en: string;
  price_usdc: string;
  format: string;
  r2_key: string | null;
  cover_url: string | null;
  spotify_url: string | null;
  duration_sec: number | null;
  track_number: number;
  sort_order: number;
  active: number;
};

const PRICE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function localizeTitle(row: { title_sv: string; title_en: string }, locale: string): string {
  return locale === "en" ? row.title_en : row.title_sv;
}

export function localizeDesc(
  row: { description_sv: string; description_en: string },
  locale: string,
): string {
  return locale === "en" ? row.description_en : row.description_sv;
}

export function publicAlbum(row: AlbumRow, locale: string, tracks: ReturnType<typeof publicTrack>[]) {
  return {
    id: row.id,
    slug: row.slug,
    title: localizeTitle(row, locale),
    description: localizeDesc(row, locale),
    price_usdc: row.price_usdc,
    spotify_url: row.spotify_url,
    /** Prefer private R2 mirror; fall back to cached Spotify CDN URL. */
    cover_url: row.cover_r2_key
      ? `/api/covers/${encodeURIComponent(row.id)}`
      : row.cover_url || null,
    tracks,
  };
}

export function publicTrack(row: TrackRow, locale: string) {
  return {
    id: row.id,
    album_id: row.album_id,
    slug: row.slug,
    title: localizeTitle(row, locale),
    price_usdc: row.price_usdc,
    format: row.format,
    spotify_url: row.spotify_url,
    cover_url: row.cover_url || null,
    duration_sec: row.duration_sec,
    track_number: row.track_number,
    /** True when FLAC/WAV is in R2 and ready to fulfill after pay. */
    downloadable: Boolean(row.r2_key),
  };
}

export async function listPublicCatalog(env: Env, locale: string) {
  const albums = await env.DB.prepare(
    `SELECT id, slug, title_sv, title_en, description_sv, description_en, price_usdc,
            cover_r2_key, cover_url, spotify_url, sort_order, active
     FROM albums WHERE active = 1 ORDER BY sort_order ASC, slug ASC`,
  ).all<AlbumRow>();

  const tracks = await env.DB.prepare(
    `SELECT id, album_id, slug, title_sv, title_en, price_usdc, format, r2_key, cover_url, spotify_url,
            duration_sec, track_number, sort_order, active
     FROM tracks WHERE active = 1 ORDER BY sort_order ASC, track_number ASC, slug ASC`,
  ).all<TrackRow>();

  const byAlbum = new Map<string, TrackRow[]>();
  const singles: TrackRow[] = [];
  for (const t of tracks.results ?? []) {
    if (t.album_id) {
      const list = byAlbum.get(t.album_id) ?? [];
      list.push(t);
      byAlbum.set(t.album_id, list);
    } else {
      singles.push(t);
    }
  }

  return {
    locale,
    albums: (albums.results ?? []).map((a) =>
      publicAlbum(
        a,
        locale,
        (byAlbum.get(a.id) ?? []).map((t) => publicTrack(t, locale)),
      ),
    ),
    tracks: singles.map((t) => publicTrack(t, locale)),
    prices: { track_usdc: "0.90", album_usdc: "10.00" },
  };
}

export function validatePrice(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim();
  if (!PRICE_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 9999) return null;
  return Number.isInteger(n) ? `${n}.00` : s.includes(".") ? s : `${s}.00`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `item-${Date.now()}`;
}

export function parseUsdcAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Sum USDC amounts as cents to avoid float drift. */
export function sumUsdc(amounts: string[]): string {
  let cents = 0;
  for (const a of amounts) {
    const [w, f = ""] = String(a).split(".");
    const frac = (f + "00").slice(0, 2);
    cents += Number(w || "0") * 100 + Number(frac);
  }
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}
