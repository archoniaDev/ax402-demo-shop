import type { Env } from "./env";
import { json } from "./http";

export const SESSION_COOKIE = "axshop_session";
export const MAGIC_LINK_TTL_S = 15 * 60;
export const SESSION_TTL_S = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

export function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of `${SESSION_SECRET}:${token}`. Raw tokens are never stored. */
export async function hashToken(env: Env, token: string): Promise<string> {
  const salt = env.SESSION_SECRET ?? "";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}:${token}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = request.headers.get("Cookie");
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function cookieAttrs(request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(request: Request, token: string): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttrs(request, SESSION_TTL_S)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; ${cookieAttrs(request, 0)}`;
}

export async function getSession(
  request: Request,
  env: Env,
): Promise<{ sessionId: string; owner: { id: string; email: string } } | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || !env.DB) return null;
  const hash = await hashToken(env, token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, o.id AS owner_id, o.email AS email
     FROM sessions s JOIN owners o ON o.id = s.owner_id
     WHERE s.session_token_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, nowS())
    .first<{ session_id: string; owner_id: string; email: string }>();
  if (!row) return null;
  return { sessionId: row.session_id, owner: { id: row.owner_id, email: row.email } };
}

export function unauthorized(): Response {
  return json(401, { error: "unauthorized" });
}

export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE|constraint failed/i.test(msg);
}
