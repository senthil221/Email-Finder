import { addRows, createJob, setJobStatus } from "@/lib/repo";
import { cleanDomain, cleanName } from "@/lib/patterns";
import { bad, db } from "@/lib/server";

/** Single lookup: queued ahead of bulk jobs. Poll /api/jobs/{id} for the result. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const first = String(body?.first ?? "");
  const last = String(body?.last ?? "");
  const domain = String(body?.domain ?? "");
  if (!cleanName(first)) return bad("First name is required");
  if (!cleanDomain(domain)) return bad("That does not look like a domain (e.g. b2bdrive.net)");
  const d = await db();
  const id = await createJob(d, {
    name: `${first} ${last} @ ${cleanDomain(domain)}`.trim(),
    kind: "single",
    priority: 10,
  });
  await addRows(d, id, 1, [{ first, last, domain, input: {} }]);
  await setJobStatus(d, id, "running");
  return Response.json({ id });
}
