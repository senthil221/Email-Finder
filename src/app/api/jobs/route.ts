import { createJob, listJobs } from "@/lib/repo";
import { bad, db } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ jobs: await listJobs(await db()) });
}

/** Create an empty bulk job; rows are added in chunks, then /start. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 200);
  if (!name) return bad("name is required");
  const columns = Array.isArray(body?.columns) ? body.columns.map(String).slice(0, 200) : [];
  const id = await createJob(await db(), { name, columns });
  return Response.json({ id });
}
