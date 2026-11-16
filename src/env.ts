export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  ASSETS: Fetcher;
  AX402_API_URL: string;
  DEFAULT_LOCALE: string;
  /** Set via `wrangler secret put` — never commit. */
  AX402_MERCHANT_KEY?: string;
  PAYOUT_ADDRESS?: string;
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  OWNER_BOOTSTRAP_EMAIL?: string;
  /** Optional contact inbox; falls back to OWNER_BOOTSTRAP_EMAIL. Comma-separated OK. */
  CONTACT_TO_EMAIL?: string;
  /** Public Turnstile site key (wrangler.toml [vars] or dashboard var). */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile widget secret — `wrangler secret put TURNSTILE_SECRET_KEY`. */
  TURNSTILE_SECRET_KEY?: string;
  /** Comma-separated hostnames allowed by Siteverify (no localhost in production). */
  TURNSTILE_HOSTNAMES?: string;
  PUBLIC_BASE_URL?: string;
  /** Local/staging only: return magic link in JSON instead of emailing. */
  MAGIC_LINK_DEV_RETURN?: string;
  /** store_orders (default) | mock (requires AX402_ALLOW_MOCK=true). */
  AX402_VERIFY_MODE?: string;
  AX402_ALLOW_MOCK?: string;
  AX402_ALLOW_LOCAL_QUOTE?: string;
  /** Spotify Developer app (Client Credentials) — cover fetch. */
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}

export function publicBase(env: Env, request: Request): string {
  const configured = String(env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
