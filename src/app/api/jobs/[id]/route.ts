import { getJob, listRows } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["pending", "found", "catch_all", "not_found", "unverified", "invalid_input"]);

/** Job summary + one page of rows (?status=found&page=0&size=100). */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  const d = await db();
  const job = await getJob(d, id);
  if (!job) return bad("not found", 404);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const size = Math.min(500, Math.max(1, Number(url.searchParams.get("size")) || 100));
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  const rows = await listRows(d, id, {
    status: status && STATUSES.has(status) ? status : undefined,
    limit: size,
    offset: page * size,
  });
  return Response.json({ job, rows });
}
