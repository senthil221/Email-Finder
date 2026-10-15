import Papa from "papaparse";
import { getJob, listRows } from "@/lib/repo";
import { bad, db, isUuid } from "@/lib/server";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  found: "Found",
  catch_all: "Catch-all",
  not_found: "Not found",
  unverified: "Unverified",
  pending: "Pending",
  invalid_input: "Invalid input",
};

/** CSV of the original columns + results. ?status=found to export one bucket. */
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/export">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad("not found", 404);
  const d = await db();
  const job = await getJob(d, id);
  if (!job) return bad("not found", 404);
  const status = new URL(req.url).searchParams.get("status") || undefined;
  if (status && !LABEL[status]) return bad("unknown status");

  const original = job.columns.length ? job.columns : ["First Name", "Last Name", "Domain"];
  const fields = [...original, "Email", "Email Status", "Pattern", "Reason", "Checks Used"];
  const data: string[][] = [];
  for (let page = 0; ; page++) {
    const rows = await listRows(d, id, { status, limit: 5000, offset: page * 5000 });
    for (const r of rows) {
      const input = job.columns.length ? r.input : { "First Name": r.first, "Last Name": r.last, Domain: r.domain };
      data.push([
        ...original.map((c) => String(input?.[c] ?? "")),
        r.email ?? "",
        LABEL[r.status] ?? r.status,
        r.pattern ?? "",
        r.reason ?? "",
        String(r.checks_used),
      ]);
    }
    if (rows.length < 5000) break;
  }

  const csv = Papa.unparse({ fields, data });
  const safeName = job.name.replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "job";
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}${status ? `-${status}` : ""}.csv"`,
    },
  });
}
