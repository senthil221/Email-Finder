import { bad, db, isUuid } from "@/lib/server";
import { lookupDetail } from "@/lib/views";

export const dynamic = "force-dynamic";

/** One lookup with its combination ladder (what was tried, in order, and the answer). */
export async function GET(_req: Request, ctx: RouteContext<"/api/lookups/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  const detail = await lookupDetail(await db(), id);
  return detail ? Response.json(detail) : bad("not found", 404);
}
