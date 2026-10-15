import { checksToday, getWorkerStatus } from "@/lib/repo";
import { dailyLimit, db } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await db();
  const [worker, used] = await Promise.all([getWorkerStatus(d), checksToday(d)]);
  // The worker writes a heartbeat every 5s; silence for 30s means it is not running.
  const online = !!worker && Date.now() - new Date(worker.heartbeat_at).getTime() < 30_000;
  return Response.json({ worker, online, checksToday: used, dailyLimit: dailyLimit() });
}
