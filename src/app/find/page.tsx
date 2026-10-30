"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Search, TriangleAlert, X } from "lucide-react";
import type { LadderStep, Lookup } from "@/lib/views";
import type { DomainState } from "@/lib/engine";
import { usePoll } from "@/components/usePoll";
import { Ago, CopyButton, PageHead, Status } from "@/components/ui";
import { toast } from "@/components/Shell";
import { foundHow, PATTERN_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";

type Detail = { lookup: Lookup; steps: LadderStep[]; domain: DomainState | null };

/** Each answer for one combination: [dot colour, words]. */
const STEP: Record<string, [string, string]> = {
  valid: ["found", "Accepted"],
  invalid: ["not_found", "Rejected"],
  catch_all: ["catch_all", "Accepts any address"],
  no_mx: ["not_found", "No mail server"],
  retry: ["running", "Checking again"],
  unverified: ["unverified", "Couldn't verify"],
  queued: ["pending", "Waiting"],
};

const COMPANY: Record<string, string> = {
  valid: "Pattern proven",
  catch_all: "Catch-all: accepts any address",
  not_found: "No match found here before",
  no_mx: "Cannot receive email",
  unknown: "Not checked before",
};

export default function FindPage() {
  return (
    <Suspense>
      <Finder />
    </Suspense>
  );
}

function Finder() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const [form, setForm] = useState({ first: "", last: "", domain: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: polled } = usePoll<Detail>(id ? `/api/lookups/${id}` : null, 1000);
  const detail = polled && polled.lookup.id === id ? polled : null; // not the previous lookup's answer
  const pending = !!id && (!detail || detail.lookup.status === "pending");
  const { data: history, reload } = usePoll<{ rows: Lookup[] }>("/api/lookups?size=8", pending ? 3000 : 15_000);

  // Announce once when a lookup started here finishes (not when one is opened from the list).
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || detail.lookup.status === "pending" || announced.current === detail.lookup.id) return;
    const mine = announced.current === "";
    announced.current = detail.lookup.id;
    if (!mine) return;
    const l = detail.lookup;
    if (l.status === "found") toast(`Found ${l.email}`);
    else if (l.status === "catch_all") toast(`${l.domain} accepts any address, so this can't be confirmed`, "warn");
    else toast(`No email found for ${l.first} ${l.last}`, "bad");
    reload();
  }, [detail, reload]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      announced.current = "";
      router.replace(`/find?id=${body.id}`, { scroll: false });
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const l = detail?.lookup;
  const tried = detail ? detail.steps.filter((s) => s.state !== "skipped" && (pending || s.state !== "queued")) : [];
  const notNeeded = detail ? detail.steps.length - tried.length : 0;

  return (
    <div className="page">
      <PageHead
        title="Find one email"
        sub="Type a name and the company's website. The usual combinations (first@, first.last@ and more) are checked one by one, stopping at the first one the mail server accepts."
      />

      <form className="card card-body" onSubmit={submit}>
        <div className="finder">
          <div className="field">
            <label htmlFor="f">First name</label>
            <input id="f" className="input" placeholder="Andrew" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="l">Last name</label>
            <input id="l" className="input" placeholder="Deepak" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="d">Company website</label>
            <input id="d" className="input" placeholder="acme.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required />
          </div>
          <button className="btn btn-primary" style={{ height: 38 }} type="submit" disabled={busy || pending}>
            {busy || pending ? <span className="spinner" /> : <Search size={16} />}
            {pending ? "Checking…" : "Find email"}
          </button>
        </div>
        {error && (
          <div className="notice err" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </form>

      {l && (
        <>
          <Result l={l} pending={pending} tried={tried.length} />
          <section className="card">
            <div className="card-head">
              <h2>What was tried</h2>
              <span className="sub" style={{ textTransform: "capitalize" }}>
                {l.first} {l.last}
              </span>
              <span className="sub">at {l.domain}</span>
              {detail?.domain && (
                <span className="tools muted" style={{ fontSize: 13 }}>
                  {COMPANY[detail.domain.status] ?? detail.domain.status}
                  {detail.domain.pattern ? ` · ${PATTERN_LABEL[detail.domain.pattern]}` : ""}
                </span>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Combination</th>
                    <th>Address</th>
                    <th>Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {tried.map((s, i) => {
                    const scanning = pending && i === tried.findIndex((x) => x.state === "queued" || x.state === "retry");
                    const [dot, word] = scanning ? ["running", "Checking…"] : (STEP[s.state] ?? ["idle", s.state]);
                    return (
                      <tr key={s.email}>
                        <td>
                          <span className="tag">{PATTERN_LABEL[s.pattern] ?? s.pattern}</span>
                        </td>
                        <td className="email">{s.email}</td>
                        <td>
                          <Status status={dot}>
                            {word}
                            {s.cached && <span className="faint"> (from an earlier check)</span>}
                          </Status>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!pending && notNeeded > 0 && (
                <p className="muted" style={{ padding: "10px 14px", fontSize: 13, borderTop: "1px solid var(--line)" }}>
                  {notNeeded} more {notNeeded === 1 ? "combination was" : "combinations were"} not needed.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Recent lookups</h2>
        </div>
        {history && history.rows.length === 0 && <div className="empty">Your lookups will show up here.</div>}
        {history && history.rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <tbody>
                {history.rows.map((h) => (
                  <tr
                    key={h.id}
                    className={`is-link${h.id === id ? " is-selected" : ""}`}
                    onClick={() => {
                      announced.current = null;
                      router.replace(`/find?id=${h.id}`, { scroll: false });
                    }}
                  >
                    <td className="name">
                      {h.first} {h.last}
                    </td>
                    <td className="muted">{h.domain}</td>
                    <td>
                      <Status status={h.status} />
                    </td>
                    <td className="email">{h.email ?? <span className="faint">—</span>}</td>
                    <td className="muted r">
                      <Ago at={h.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Result({ l, pending, tried }: { l: Lookup; pending: boolean; tried: number }) {
  if (pending) {
    return (
      <div className="result" aria-live="polite">
        <span className="ico">
          <span className="spinner" />
        </span>
        <div>
          <b>Checking…</b>
          <div className="muted">{tried ? `${tried} combinations so far` : "Starting"}</div>
        </div>
      </div>
    );
  }
  if (l.status === "found") {
    return (
      <div className="result found always" aria-live="polite">
        <span className="ico">
          <Check size={20} strokeWidth={2.5} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="big">{l.email}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {foundHow(l.reason)}
            {l.pattern ? ` · ${PATTERN_LABEL[l.pattern] ?? l.pattern}` : ""}
          </div>
        </div>
        <CopyButton text={l.email!} />
      </div>
    );
  }
  const catchAll = l.status === "catch_all";
  return (
    <div className={`result ${catchAll ? "catch_all" : "not_found"}`} aria-live="polite">
      <span className="ico">{catchAll ? <TriangleAlert size={19} /> : <X size={20} strokeWidth={2.5} />}</span>
      <div>
        <b>{catchAll ? "Can't be confirmed: catch-all company" : STATUS_LABEL[l.status]}</b>
        <div className="muted" style={{ fontSize: 13 }}>
          {catchAll ? `${l.domain} accepts any address, so MailTester can't tell which one is real.` : (REASON_LABEL[l.reason ?? ""] ?? "")}
        </div>
      </div>
    </div>
  );
}
