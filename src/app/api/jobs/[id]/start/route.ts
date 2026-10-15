import { setJobStatus } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/start">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  await setJobStatus(await db(), id, "running");
  return Response.json({ ok: true });
}
