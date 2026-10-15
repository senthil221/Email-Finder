import { setJobStatus } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

/** Stop a job. People already in progress finish; the rest stay pending. */
export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  await setJobStatus(await db(), id, "cancelled");
  return Response.json({ ok: true });
}
