import type { Env } from "./env";

export async function sendResendEmail(
  env: Env,
  opts: { to: string; subject: string; text: string; replyTo?: string },
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return false;
  const payload: Record<string, unknown> = {
    from: env.RESEND_FROM_EMAIL,
    to: [opts.to],
    subject: opts.subject,
    text: opts.text,
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function sendDownloadEmail(
  env: Env,
  opts: {
    to: string;
    orderId: string;
    links: { title: string; url: string }[];
    locale: string;
  },
): Promise<boolean> {
  const sv = opts.locale !== "en";
  const subject = sv
    ? `Ax402 Demo Shop — dina nedladdningar (order ${opts.orderId.slice(0, 8)})`
    : `Ax402 Demo Shop — your downloads (order ${opts.orderId.slice(0, 8)})`;
  const intro = sv
    ? "Tack för köpet. Här är tidsbegränsade nedladdningslänkar:"
    : "Thanks for your purchase. Here are time-limited download links:";
  const note = sv
    ? "Varje fillänk fungerar upp till 5 gånger och går ut efter 7 dagar. Spara filerna lokalt."
    : "Each file link works up to 5 times and expires after 7 days. Save the files locally.";
  const lines = opts.links.map((l) => `- ${l.title}\n  ${l.url}`).join("\n\n");
  const empty = sv
    ? "(Inga ljudfiler är uppladdade ännu — admin lägger till FLAC/WAV snart.)"
    : "(No audio files uploaded yet — admin will add FLAC/WAV soon.)";
  const base = String(env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const signoff = base ? `— Ax402 Demo Shop\n${base}` : "— Ax402 Demo Shop";
  const text = `${intro}\n\n${lines || empty}\n\n${note}\n\n${signoff}`;
  return sendResendEmail(env, { to: opts.to, subject, text });
}
