import { CA_AUTO, setSetting, stopCatchAll } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";
import { catchAllView } from "@/lib/views";

export const dynamic = "force-dynamic";

/** no2bounce progress at catch-all companies: the switch, the queue, results. */
export async function GET() {
  return Response.json(await catchAllView(await db()));
}

/**
 * Body: { auto: true | false } switches the background pass on or off (the worker
 * notices within seconds), or { stop: "all" | <list id> } takes people off the queue.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { auto?: unknown; stop?: unknown } | null;
  const d = await db();
  if (typeof body?.auto === "boolean") {
    await setSetting(d, CA_AUTO, body.auto);
    return Response.json({ auto: body.auto });
  }
  if (body?.stop === "all" || (typeof body?.stop === "string" && isUuid(body.stop))) {
    const stopped = await stopCatchAll(d, body.stop === "all" ? null : body.stop);
    return Response.json({ stopped });
  }
  return bad("say auto: true or false, or stop: \"all\" or a list id");
}
