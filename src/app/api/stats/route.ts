import { getWorkerStatus, listJobs } from "@/lib/repo";
import { dailyLimit, db } from "@/lib/server";
import { overview } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Everything the dashboard shows, in one call. */
export async function GET() {
  const d = await db();
  const [ov, jobs, worker] = await Promise.all([overview(d), listJobs(d, 8), getWorkerStatus(d)]);
  const online = !!worker && Date.now() - new Date(worker.heartbeat_at).getTime() < 30_000;
  return Response.json({ ...ov, jobs, worker, online, dailyLimit: dailyLimit(), now: Date.now() });
}
