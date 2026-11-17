import type { Env } from "./env";
import { normalizeEmail } from "./auth";
import { sendResendEmail } from "./email";
import { json } from "./http";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_ACTION = "contact";
const RATE_LIMIT = 5;
const RATE_WINDOW_S = 600;
const NAME_MAX = 120;
const MESSAGE_MAX = 4000;
const TOKEN_MAX = 2048;

export type ContactBody = {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  locale?: unknown;
  company?: unknown;
  "cf-turnstile-response"?: unknown;
  turnstile_token?: unknown;
};

export function contactConfig(env: Env): Response {
  const siteKey = String(env.TURNSTILE_SITE_KEY ?? "").trim();
  return json(200, {
    turnstile_site_key: siteKey || null,
    turnstile_required: Boolean(String(env.TURNSTILE_SECRET_KEY ?? "").trim()),
  });
}

export async function submitContact(request: Request, env: Env): Promise<Response> {
  const body = (await readContactBody(request)) ?? {};
  // Honeypot first: pretend success so bots leave quietly (even if mail is unset).
  if (typeof body.company === "string" && body.company.trim()) {
    return json(200, { ok: true });
  }

  const to = resolveContactTo(env);
  const resendReady = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
  const secret = String(env.TURNSTILE_SECRET_KEY ?? "").trim();
  const siteKey = String(env.TURNSTILE_SITE_KEY ?? "").trim();

  if (!to || !resendReady || !secret || !siteKey) {
    return json(503, { ok: false, error: "unavailable" });
  }

  const name = trimField(body.name, NAME_MAX);
  const emailRaw = trimField(body.email, 200);
  const message = trimField(body.message, MESSAGE_MAX);
  if (!name) return json(400, { ok: false, error: "name_required" });
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return json(400, { ok: false, error: "email_invalid" });
  }
  if (!message || message.length < 10) {
    return json(400, { ok: false, error: "message_required" });
  }

  const locale = body.locale === "en" ? "en" : "sv";
  const tokenRaw =
    typeof body["cf-turnstile-response"] === "string"
      ? body["cf-turnstile-response"]
      : typeof body.turnstile_token === "string"
        ? body.turnstile_token
        : "";
  const token = tokenRaw.trim();

  const verified = await verifyTurnstile(env, request, token);
  if (!verified) return json(403, { ok: false, error: "turnstile_failed" });

  const allowed = await allowContactRequest(request);
  if (!allowed) return json(429, { ok: false, error: "rate_limited" });

  const email = emailRaw.toLowerCase();
  const subject =
    locale === "en"
      ? `Archonia Verify Demo Shop contact — ${name}`
      : `Archonia Verify Demo Shop kontakt — ${name}`;
  const base = String(env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "") || "shop";
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Locale: ${locale}`,
    "",
    message,
    "",
    `— ${base}/contact/`,
  ].join("\n");

  const sent = await sendResendEmail(env, {
    to,
    subject,
    text,
    replyTo: email,
  });
  if (!sent) return json(502, { ok: false, error: "email_send_failed" });
  return json(200, { ok: true });
}

function resolveContactTo(env: Env): string | null {
  const preferred = String(env.CONTACT_TO_EMAIL ?? "")
    .split(",")
    .map((s) => normalizeEmail(s))
    .find(Boolean);
  if (preferred) return preferred;
  return normalizeEmail(env.OWNER_BOOTSTRAP_EMAIL);
}

async function readContactBody(request: Request): Promise<ContactBody | null> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const body = await request.json();
      return body && typeof body === "object" && !Array.isArray(body)
        ? (body as ContactBody)
        : null;
    } catch {
      return null;
    }
  }
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await request.formData();
      const out: ContactBody = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") (out as Record<string, string>)[key] = value;
      }
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

function trimField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, max);
  return s || null;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function turnstileHostnames(env: Env): Set<string> {
  return new Set(
    String(env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Canonical Turnstile Siteverify — fail closed on network/parse/mismatch.
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export async function verifyTurnstile(
  env: Env,
  request: Request,
  token: string,
): Promise<boolean> {
  const secret = String(env.TURNSTILE_SECRET_KEY ?? "").trim();
  const expectedHostnames = turnstileHostnames(env);
  if (
    !secret ||
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > TOKEN_MAX ||
    expectedHostnames.size === 0
  ) {
    return false;
  }

  let result: {
    success?: boolean;
    action?: string;
    hostname?: string;
    "error-codes"?: string[];
    metadata?: { result_with_testing_key?: boolean };
  };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: clientIp(request),
      }),
    });
    if (!res.ok) return false;
    result = (await res.json()) as typeof result;
  } catch (err) {
    console.warn("turnstile_siteverify_failed", err);
    return false;
  }

  if (result.success !== true) return false;

  // Cloudflare dummy keys omit `action` and return hostname example.com.
  const testingKey = result.metadata?.result_with_testing_key === true;
  if (testingKey) return true;

  const hostname = String(result.hostname ?? "").toLowerCase();
  return result.action === CONTACT_ACTION && expectedHostnames.has(hostname);
}

/**
 * Free-tier friendly IP rate limit via Cache API (no KV).
 * Key uses the request host so custom domains do not 502 (ax402 lesson).
 */
async function allowContactRequest(request: Request): Promise<boolean> {
  try {
    const ip = clientIp(request);
    const host = new URL(request.url).host;
    const cacheKey = new Request(
      `https://${host}/__rl/contact/${encodeURIComponent(ip)}`,
      { method: "GET" },
    );
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    let count = 0;
    if (hit) {
      const text = await hit.text();
      count = Number(text) || 0;
      if (count >= RATE_LIMIT) return false;
    }
    await cache.put(
      cacheKey,
      new Response(String(count + 1), {
        headers: {
          "Cache-Control": `public, max-age=${RATE_WINDOW_S}`,
          "Content-Type": "text/plain",
        },
      }),
    );
    return true;
  } catch (err) {
    console.warn("contact_rate_limit_failed", err);
    // Fail open on Cache API quirks in local/dev so legit mail still works.
    return true;
  }
}
