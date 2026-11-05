import { requestCatchAll, requestCatchAllCount } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

/**
 * Queue catch-all people in this list for a no2bounce check (paid; the worker picks them
 * up within seconds). Body: { ids: ["123", ...] } for chosen people, { count: 500 } for the
 * next 500 with the best odds (add google: true to let Google mail in), or { all: true }.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/catch-all">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  const body = (await req.json().catch(() => null)) as { ids?: unknown; all?: unknown; count?: unknown; google?: unknown } | null;
  if (body?.count !== undefined) {
    const count = body.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 1_000_000) return bad("say how many, as a whole number");
    return Response.json({ queued: await requestCatchAllCount(await db(), id, count, { google: body.google === true }) });
  }
  let ids: string[] | null = null;
  if (body?.all !== true) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) return bad("choose people, or all");
    if (body.ids.length > 10_000) return bad("too many at once");
    if (!body.ids.every((x) => typeof x === "string" && /^\d{1,18}$/.test(x))) return bad("bad ids");
    ids = body.ids as string[];
  }
  const queued = await requestCatchAll(await db(), id, ids);
  return Response.json({ queued });
}
