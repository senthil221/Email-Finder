"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Search } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { JobsTable } from "@/components/JobsTable";
import { usePoll } from "@/components/usePoll";
import { PATTERN_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";
import type { JobRow, JobSummary } from "@/lib/repo";

export default function Home() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [domain, setDomain] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = usePoll<{ job: JobSummary; rows: JobRow[] }>(jobId ? `/api/jobs/${jobId}` : null, 1500);
  const row = data?.rows[0];
  const working = !!jobId && (!row || row.status === "pending");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first, last, domain }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setJobId(body.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Topbar title="Find an email" />
      <div className="content">
        <section className="card">
          <div className="card-head">
            <h2>Single lookup</h2>
            <p>Tries the 9 name combinations with MailTester Ninja and stops at the first valid one.</p>
          </div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <form className="row-form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="first">First name</label>
                <input id="first" className="input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Senthil" required />
              </div>
              <div className="field">
                <label htmlFor="last">Last name</label>
                <input id="last" className="input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Nathan" />
              </div>
              <div className="field">
                <label htmlFor="domain">Company domain</label>
                <input id="domain" className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="b2bdrive.net" required />
              </div>
              <button className="btn btn-primary" type="submit" disabled={submitting || working} style={{ height: 34 }}>
                <Search size={15} strokeWidth={1.75} />
                {working ? "Checking…" : "Find email"}
              </button>
            </form>
            {error && <div className="notice err">{error}</div>}
            {jobId && <LookupResult row={row} working={working} />}
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="toolbar">
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>Recent uploads</h2>
            <span className="spacer" />
            <Link href="/jobs" className="btn btn-sm">
              All jobs
            </Link>
            <Link href="/jobs/new" className="btn btn-sm btn-primary">
              Upload CSV
            </Link>
          </div>
          <JobsTable limit={5} />
        </section>
      </div>
    </>
  );
}

function LookupResult({ row, working }: { row?: JobRow; working: boolean }) {
  const [copied, setCopied] = useState(false);
  if (working || !row) {
    return (
      <div className="result-line">
        <span className="status pending">Checking combinations… this usually takes a few seconds.</span>
      </div>
    );
  }
  return (
    <div className="result-line">
      <span className={`status ${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
      {row.email ? (
        <>
          <span className="email mono">{row.email}</span>
          <button
            className="copy-btn"
            title="Copy"
            onClick={() => {
              navigator.clipboard.writeText(row.email!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} strokeWidth={1.5} />}
          </button>
          {row.pattern && <span className="tag">{PATTERN_LABEL[row.pattern] ?? row.pattern}</span>}
        </>
      ) : (
        <span className="muted">{(row.reason && REASON_LABEL[row.reason]) ?? ""}</span>
      )}
      <span className="faint num" style={{ marginLeft: "auto" }}>
        {row.checks_used} {row.checks_used === 1 ? "check" : "checks"} used
      </span>
    </div>
  );
}
