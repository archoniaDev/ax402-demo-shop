/**
 * Archonia Verify Demo Shop Worker — public site + API (catalog, Archonia Verify pay, R2 downloads, admin).
 */

import type { Env } from "./env";
import { handleApi } from "./routes";

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") {
      return Response.json(
        {
          ok: true,
          service: "ax402-demo-shop",
          bindings: {
            db: Boolean(env.DB),
            audio: Boolean(env.AUDIO),
            assets: Boolean(env.ASSETS),
          },
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (path.startsWith("/api/")) {
      return handleApi(request, env, ctx, path);
    }

    return env.ASSETS.fetch(request);
  },
};
