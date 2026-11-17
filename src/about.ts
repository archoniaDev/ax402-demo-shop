import type { Env } from "./env";

export type AboutContent = {
  id: number;
  title_sv: string;
  title_en: string;
  lede_sv: string;
  lede_en: string;
  body_sv: string;
  body_en: string;
  updated_at: number;
};

/** Static i18n defaults — used when D1 row is missing or a field is blank. */
export const ABOUT_I18N_DEFAULTS = {
  title_sv: "Om",
  title_en: "About",
  lede_sv: "Demo-butik för digitala nedladdningar med USDC på Base.",
  lede_en: "Demo shop for digital downloads with USDC on Base.",
  body_sv:
    "Archonia Verify Demo Shop är en offentlig mall. Byt ut den här texten, katalogen och varumärket mot ditt eget.",
  body_en:
    "Archonia Verify Demo Shop is a public template. Replace this copy, the catalog, and the branding with your own.",
} as const;

const SELECT =
  `SELECT id, title_sv, title_en, lede_sv, lede_en, body_sv, body_en, updated_at
   FROM about_content WHERE id = 1`;

export async function loadAbout(env: Env): Promise<AboutContent | null> {
  if (!env.DB) return null;
  return (await env.DB.prepare(SELECT).first<AboutContent>()) ?? null;
}

/** Public payload: DB values with empty fields filled from static defaults. */
export function publicAbout(row: AboutContent | null) {
  const src = row ?? ({} as Partial<AboutContent>);
  const pick = (key: keyof typeof ABOUT_I18N_DEFAULTS): string => {
    const v = src[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    return ABOUT_I18N_DEFAULTS[key];
  };
  return {
    title_sv: pick("title_sv"),
    title_en: pick("title_en"),
    lede_sv: pick("lede_sv"),
    lede_en: pick("lede_en"),
    body_sv: pick("body_sv"),
    body_en: pick("body_en"),
    updated_at: row?.updated_at ?? null,
    source: row ? ("db" as const) : ("defaults" as const),
  };
}

export type AboutPatch = {
  title_sv?: string;
  title_en?: string;
  lede_sv?: string;
  lede_en?: string;
  body_sv?: string;
  body_en?: string;
};

const MAX = {
  title_sv: 120,
  title_en: 120,
  lede_sv: 500,
  lede_en: 500,
  body_sv: 8000,
  body_en: 8000,
} as const;

function field(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max);
}

/** Upsert singleton About row. Empty strings are allowed (public falls back to i18n). */
export async function saveAbout(env: Env, patch: AboutPatch): Promise<AboutContent> {
  const existing = await loadAbout(env);
  const next = {
    title_sv:
      patch.title_sv !== undefined
        ? (field(patch.title_sv, MAX.title_sv) ?? "")
        : (existing?.title_sv ?? ABOUT_I18N_DEFAULTS.title_sv),
    title_en:
      patch.title_en !== undefined
        ? (field(patch.title_en, MAX.title_en) ?? "")
        : (existing?.title_en ?? ABOUT_I18N_DEFAULTS.title_en),
    lede_sv:
      patch.lede_sv !== undefined
        ? (field(patch.lede_sv, MAX.lede_sv) ?? "")
        : (existing?.lede_sv ?? ABOUT_I18N_DEFAULTS.lede_sv),
    lede_en:
      patch.lede_en !== undefined
        ? (field(patch.lede_en, MAX.lede_en) ?? "")
        : (existing?.lede_en ?? ABOUT_I18N_DEFAULTS.lede_en),
    body_sv:
      patch.body_sv !== undefined
        ? (field(patch.body_sv, MAX.body_sv) ?? "")
        : (existing?.body_sv ?? ABOUT_I18N_DEFAULTS.body_sv),
    body_en:
      patch.body_en !== undefined
        ? (field(patch.body_en, MAX.body_en) ?? "")
        : (existing?.body_en ?? ABOUT_I18N_DEFAULTS.body_en),
  };

  await env.DB.prepare(
    `INSERT INTO about_content (id, title_sv, title_en, lede_sv, lede_en, body_sv, body_en, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
     ON CONFLICT(id) DO UPDATE SET
       title_sv = excluded.title_sv,
       title_en = excluded.title_en,
       lede_sv = excluded.lede_sv,
       lede_en = excluded.lede_en,
       body_sv = excluded.body_sv,
       body_en = excluded.body_en,
       updated_at = strftime('%s', 'now')`,
  )
    .bind(next.title_sv, next.title_en, next.lede_sv, next.lede_en, next.body_sv, next.body_en)
    .run();

  const saved = await loadAbout(env);
  if (!saved) throw new Error("about_save_failed");
  return saved;
}
