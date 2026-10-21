import { addRows, getJob, type RowInput } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

const MAX_ROWS = 5000;

/** Add a chunk of rows: { start: <row number of the first row>, rows: [{first,last,domain,input}] } */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/rows">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.rows)) return bad("rows must be an array");
  if (body.rows.length > MAX_ROWS) return bad(`at most ${MAX_ROWS} rows per request`);
  const d = await db();
  const job = await getJob(d, id);
  if (!job) return bad("not found", 404);
  if (job.status !== "uploading") return bad("job already started");
  const rows: RowInput[] = body.rows.map((r: Record<string, unknown>) => ({
    first: String(r?.first ?? ""),
    last: String(r?.last ?? ""),
    domain: String(r?.domain ?? ""),
    linkedin: r?.linkedin ? String(r.linkedin) : undefined,
    input: r?.input && typeof r.input === "object" ? (r.input as Record<string, string>) : {},
  }));
  const start = Math.max(1, Number(body.start) || 1);
  return Response.json(await addRows(d, id, start, rows));
}
