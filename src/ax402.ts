/**
 * Ax402 client for Ax402 Demo Shop — merchant-quote + store/orders verify.
 *
 * AX402_VERIFY_MODE:
 *   store_orders (default) — POST {AX402_API_URL}/store/orders with quote_id + payment_data.hash
 *   mock — STAGING ONLY; requires AX402_ALLOW_MOCK=true
 *
 * Production quotes: AX402_MERCHANT_KEY (yogm_…) → POST /v1/merchant/quotes
 */

import type { Env } from "./env";

export const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function verifyMode(env: Env): "mock" | "store_orders" {
  const raw = String(env.AX402_VERIFY_MODE ?? "").trim().toLowerCase();
  const allowMock = String(env.AX402_ALLOW_MOCK) === "true";
  if (raw === "mock" && allowMock) return "mock";
  return "store_orders";
}

function apiBase(env: Env): string {
  return String(env.AX402_API_URL ?? "").replace(/\/+$/, "");
}

function isLocalUrl(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

function merchantKey(env: Env): string {
  const key = String(env.AX402_MERCHANT_KEY ?? "").trim();
  return /^yogm_[A-Za-z0-9]+$/.test(key) ? key : "";
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

export type QuoteSku = { sku: string; amount_usdc: string };

/**
 * Resolve an Ax402 quote_id for a cart line / order total.
 * Uses a single sku representing the order (track slug or album slug or cart-composite).
 */
export async function obtainQuote(
  env: Env,
  item: QuoteSku,
): Promise<{ ok: true; quote_id: string | null } | { ok: false; error: string; detail: string }> {
  if (verifyMode(env) === "mock") return { ok: true, quote_id: null };

  const base = apiBase(env);
  const key = merchantKey(env);
  if (key && base) {
    try {
      const { status, body } = await fetchJson(`${base}/v1/merchant/quotes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          sku: item.sku,
          amount_usdc: String(item.amount_usdc),
          quantity: 1,
        }),
      });
      if (status === 200 && typeof body?.quote_id === "string") {
        return { ok: true, quote_id: body.quote_id };
      }
      return {
        ok: false,
        error: "ax402_quote_unavailable",
        detail: `Ax402 merchant quote failed (${status}): ${String(body?.detail ?? body?.error ?? "unknown")}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: "ax402_quote_unavailable",
        detail: `Ax402 merchant quote unreachable: ${err instanceof Error ? err.message : "fetch failed"}`,
      };
    }
  }

  if (String(env.AX402_ALLOW_LOCAL_QUOTE) === "true" && isLocalUrl(base)) {
    try {
      const { status, body } = await fetchJson(`${base}/store/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: item.sku, quantity: 1 }),
      });
      if (status === 200 && typeof body?.quote_id === "string") {
        return { ok: true, quote_id: body.quote_id };
      }
      return {
        ok: false,
        error: "ax402_quote_unavailable",
        detail: `local Ax402 quote create failed (${status}): ${String(body?.error ?? "unknown")}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: "ax402_quote_unavailable",
        detail: `local Ax402 unreachable: ${err instanceof Error ? err.message : "fetch failed"}`,
      };
    }
  }

  return {
    ok: false,
    error: "ax402_quote_unavailable",
    detail:
      `No Ax402 quote_id for sku "${item.sku}". Set AX402_MERCHANT_KEY (yogm_…) so the shop can ` +
      "POST /v1/merchant/quotes. Public POST /store/quotes stays blocked in production.",
  };
}

export async function verifyPayment(
  env: Env,
  order: { quote_id: string | null; buyer_email: string },
  hash: string,
): Promise<
  | { ok: true; mode: string; ax402_order_id: string | null }
  | { ok: false; status: number; error: string; detail: string }
> {
  if (!TX_HASH_RE.test(hash)) {
    return { ok: false, status: 400, error: "invalid_hash", detail: "payment_data.hash must be 0x + 64 hex chars" };
  }

  if (verifyMode(env) === "mock") {
    return { ok: true, mode: "mock", ax402_order_id: null };
  }

  if (!order.quote_id) {
    return {
      ok: false,
      status: 503,
      error: "ax402_quote_unavailable",
      detail: "order has no Ax402 quote_id; cannot verify via /store/orders",
    };
  }

  const payload: Record<string, unknown> = {
    quote_id: order.quote_id,
    payment_data: { hash },
  };
  if (order.buyer_email) payload.email = order.buyer_email;

  let res: { status: number; body: Record<string, unknown> | null };
  try {
    res = await fetchJson(`${apiBase(env)}/store/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: "ax402_unreachable",
      detail: err instanceof Error ? err.message : "fetch failed",
    };
  }

  if (res.status === 201) {
    const orderId = typeof res.body?.order_id === "string" ? res.body.order_id : null;
    return { ok: true, mode: "store_orders", ax402_order_id: orderId };
  }

  const detail = String(res.body?.detail ?? res.body?.error ?? `Ax402 responded ${res.status}`);
  const status = res.status >= 500 ? 502 : res.status === 409 ? 409 : 400;
  return {
    ok: false,
    status,
    error: res.status >= 500 ? "ax402_error" : "payment_not_verified",
    detail: `Ax402 ${res.status}: ${detail}`,
  };
}
