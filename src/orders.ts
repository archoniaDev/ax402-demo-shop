import type { Env } from "./env";
import { ADDRESS_RE } from "./ax402";
import {
  type AlbumRow,
  type TrackRow,
  localizeTitle,
  sumUsdc,
} from "./catalog";
import type { OrderItem } from "./downloads";
import { json } from "./http";

export type OrderRow = {
  id: string;
  locale: string;
  status: string;
  buyer_email: string;
  items_json: string;
  amount_usdc: string;
  quote_id: string | null;
  payment_tx_hash: string | null;
  ax402_order_id: string | null;
  created_at: number;
  updated_at: number;
};

export function paymentRequiredPayload(env: Env, order: OrderRow) {
  return {
    network: "base",
    token: "USDC",
    amount: order.amount_usdc,
    recipient_address: env.PAYOUT_ADDRESS,
    order_id: order.id,
    ...(order.quote_id ? { quote_id: order.quote_id } : {}),
  };
}

export function paymentRequiredResponse(env: Env, order: OrderRow): Response {
  const payload = paymentRequiredPayload(env, order);
  const { network, token, amount, recipient_address } = payload;
  const header = btoa(JSON.stringify({ network, token, amount, recipient_address }));
  return json(402, payload, { "PAYMENT-REQUIRED": header });
}

export function publicOrder(
  env: Env,
  row: OrderRow,
  downloads?: { title: string; url: string; expires_at: number }[],
) {
  let items: OrderItem[] = [];
  try {
    items = JSON.parse(row.items_json) as OrderItem[];
  } catch {
    items = [];
  }
  const locale = row.locale === "en" ? "en" : "sv";
  const view: Record<string, unknown> = {
    order_id: row.id,
    status: row.status,
    locale,
    amount: row.amount_usdc,
    token: "USDC",
    network: "base",
    items: items.map((i) => ({
      kind: i.kind,
      id: i.id,
      slug: i.slug,
      title: localizeTitle(i, locale),
      price_usdc: i.price_usdc,
    })),
    payment_tx_hash: row.payment_tx_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.status === "pending_payment") {
    view.payment = {
      network: "base",
      token: "USDC",
      amount: row.amount_usdc,
      recipient_address: env.PAYOUT_ADDRESS ?? null,
      ...(row.quote_id ? { quote_id: row.quote_id } : {}),
    };
  }
  if ((row.status === "paid" || row.status === "fulfilled") && downloads) {
    view.downloads = downloads;
  }
  return view;
}

export type CartLineIn = { kind: "track" | "album"; id: string };

export async function resolveCartItems(
  env: Env,
  lines: CartLineIn[],
): Promise<{ ok: true; items: OrderItem[]; amount: string; sku: string } | { ok: false; error: string }> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: "cart_empty" };
  }
  if (lines.length > 40) return { ok: false, error: "cart_too_large" };

  const items: OrderItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line || (line.kind !== "track" && line.kind !== "album") || typeof line.id !== "string") {
      return { ok: false, error: "cart_invalid" };
    }
    const key = `${line.kind}:${line.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (line.kind === "album") {
      const a = await env.DB.prepare(
        `SELECT id, slug, title_sv, title_en, price_usdc, active FROM albums WHERE id = ?`,
      )
        .bind(line.id.trim())
        .first<AlbumRow>();
      if (!a || !a.active) return { ok: false, error: "album_not_found" };
      items.push({
        kind: "album",
        id: a.id,
        slug: a.slug,
        title_sv: a.title_sv,
        title_en: a.title_en,
        price_usdc: a.price_usdc,
      });
    } else {
      const t = await env.DB.prepare(
        `SELECT id, album_id, slug, title_sv, title_en, price_usdc, format, r2_key, spotify_url,
                duration_sec, track_number, sort_order, active
         FROM tracks WHERE id = ?`,
      )
        .bind(line.id.trim())
        .first<TrackRow>();
      if (!t || !t.active) return { ok: false, error: "track_not_found" };
      items.push({
        kind: "track",
        id: t.id,
        slug: t.slug,
        title_sv: t.title_sv,
        title_en: t.title_en,
        price_usdc: t.price_usdc,
      });
    }
  }

  if (!items.length) return { ok: false, error: "cart_empty" };

  const amount = sumUsdc(items.map((i) => i.price_usdc));
  const sku =
    items.length === 1
      ? items[0].slug
      : `axshop-cart-${items
          .map((i) => i.slug)
          .sort()
          .join("-")
          .slice(0, 80)}`;

  return { ok: true, items, amount, sku };
}

export function assertPayoutConfigured(env: Env): Response | null {
  if (!ADDRESS_RE.test(String(env.PAYOUT_ADDRESS ?? ""))) {
    return json(503, {
      error: "misconfigured",
      detail: "PAYOUT_ADDRESS is not set to a valid 0x address",
    });
  }
  return null;
}

export async function loadOrder(env: Env, id: string): Promise<OrderRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, locale, status, buyer_email, items_json, amount_usdc, quote_id,
              payment_tx_hash, ax402_order_id, created_at, updated_at
       FROM orders WHERE id = ?`,
    )
      .bind(id)
      .first<OrderRow>()) ?? null
  );
}
