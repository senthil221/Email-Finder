"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, Check, Clock, Globe, History, ScanSearch, Sparkles, X } from "lucide-react";
import type { LadderStep, Lookup } from "@/lib/views";
import type { DomainState } from "@/lib/engine";
import { usePoll } from "@/components/usePoll";
import { Ladder } from "@/components/live";
import { Ago, Chip, CopyButton, PageHead } from "@/components/ui";
import { toast } from "@/components/Shell";
import { PATTERN_LABEL, REASON_LABEL, STATUS_LABEL } from "@/components/format";

type Detail = { lookup: Lookup; steps: LadderStep[]; domain: DomainState | null };

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

  const { data: detail } = usePoll<Detail>(id ? `/api/lookups/${id}` : null, 900);
  const pending = !!id && (!detail || detail.lookup.status === "pending");
  const { data: history, reload } = usePoll<{ rows: Lookup[] }>("/api/lookups?size=14", pending ? 2000 : 8000);

  // Celebrate once when a lookup we are watching finishes.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || detail.lookup.status === "pending" || announced.current === detail.lookup.id) return;
    if (announced.current === null && !busy) {
      announced.current = detail.lookup.id; // opened from history: no toast
      return;
    }
    announced.current = detail.lookup.id;
    const l = detail.lookup;
    if (l.status === "found") toast(`Found ${l.email}`, "ok");
    else if (l.status === "catch_all") toast(`${l.domain} accepts every address (catch-all)`, "warn");
    else toast(`No email found for ${l.first} ${l.last}`, "bad");
    reload();
  }, [detail, busy, reload]);

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
  const tried = detail ? detail.steps.filter((s) => !["queued", "skipped"].includes(s.state)).length : 0;

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <ScanSearch size={13} /> Live finder
          </>
        }
        title={
          <>
            Name in, <i>inbox</i> out.
          </>
        }
        sub="Watch every combination get checked in real time. Tip: press Ctrl K anywhere and type “Andrew Deepak acme.com”."
      />

      <section className="grid g-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <form className="panel glow rise" style={{ ["--i" as string]: 1 }} onSubmit={submit}>
            <div className="panel-body finder">
              <div className="field">
                <label htmlFor="f">First name</label>
                <input id="f" className="input input-lg" placeholder="Andrew" value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="l">Last name</label>
                <input id="l" className="input input-lg" placeholder="Deepak" value={form.last} onChange={(e) => setForm({ ...form, last: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="d">Company domain or website</label>
                <input id="d" className="input input-lg mono" placeholder="acme.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required />
              </div>
              <button className="btn btn-primary btn-lg" type="submit" disabled={busy || pending}>
                {busy || pending ? <span className="spinner" style={{ borderTopColor: "var(--accent-ink)" }} /> : <Sparkles size={16} />}
                {pending ? "Scanning…" : "Find email"}
              </button>
            </div>
            {error && (
              <div className="panel-body" style={{ paddingTop: 0 }}>
                <div className="notice err">{error}</div>
              </div>
            )}
          </form>

          {l && !pending && <Result l={l} />}

          {id && (
            <div className="panel rise" style={{ ["--i" as string]: 2 }}>
              <div className="panel-head">
                <h2 className="panel-title">
                  <ScanSearch size={15} /> Combination scan
                </h2>
                {l && (
                  <span className="panel-sub" style={{ textTransform: "capitalize" }}>
                    {l.first} {l.last} · <span className="mono" style={{ textTransform: "none" }}>{l.domain}</span>
                  </span>
                )}
                <div className="panel-tools">
                  {l && (
                    <span className="faint num" style={{ fontSize: 12 }}>
                      {tried} tried · {l.checks_used} paid {l.checks_used === 1 ? "check" : "checks"}
                    </span>
                  )}
                  {l && <Chip status={pending ? "running" : l.status} />}
                </div>
              </div>
              <div className="panel-body">
                {detail ? (
                  <Ladder steps={detail.steps} pending={pending} />
                ) : (
                  <div className="ladder">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i} className="skel" style={{ height: 46, borderRadius: 11 }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!id && (
            <div className="panel rise" style={{ ["--i" as string]: 2 }}>
              <div className="empty" style={{ padding: "56px 20px" }}>
                <span className="radar" style={{ width: 54, height: 54 }} />
                <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 500 }}>Ready to scan</div>
                <div style={{ maxWidth: 420 }}>
                  Enter a name and domain. The finder tries first@, first.last@, firstlast@ and 6 more, and stops at the first one the mail server accepts.
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {detail?.domain && <DomainIntel d={detail.domain} />}
          <div className="panel rise" style={{ ["--i" as string]: 3 }}>
            <div className="panel-head">
              <h2 className="panel-title">
                <History size={15} /> Recent lookups
              </h2>
            </div>
            <div style={{ padding: "8px 8px 10px" }}>
              {(history?.rows ?? []).map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    announced.current = null;
                    router.replace(`/find?id=${h.id}`, { scroll: false });
                  }}
                  className="feed-item"
                  style={{
                    width: "100%",
                    border: 0,
                    background: h.id === id ? "var(--surface-3)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    gridTemplateColumns: "22px minmax(0,1fr) auto",
                  }}
                >
                  <span className={`fi-icon ${h.status === "found" ? "valid" : h.status === "catch_all" ? "catch_all" : h.status === "pending" ? "rate_limited" : "invalid"}`}>
                    {h.status === "found" ? <Check size={13} strokeWidth={2.4} /> : h.status === "catch_all" ? <Asterisk size={13} /> : h.status === "pending" ? <Clock size={12} /> : <X size={13} />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.first} {h.last}
                    </span>
                    <span className="fi-email faint" style={{ display: "block", fontSize: 11.5 }}>
                      {h.email ?? h.domain}
                    </span>
                  </span>
                  <span className="fi-meta">
                    <Ago at={h.created_at} />
                  </span>
                </button>
              ))}
              {history && history.rows.length === 0 && <div className="empty">Your lookups will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Result({ l }: { l: Lookup }) {
  if (l.status === "found") {
    return (
      <div className="hero-result">
        <span className="hero-icon">
          <Check size={24} strokeWidth={3} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Verified · pattern <span className="tag">{PATTERN_LABEL[l.pattern ?? ""] ?? l.pattern}</span>
          </div>
          <div className="big">{l.email}</div>
        </div>
        <CopyButton text={l.email!} size={16} />
      </div>
    );
  }
  const catchAll = l.status === "catch_all";
  return (
    <div className={`hero-result ${catchAll ? "catch" : l.status === "unverified" ? "unv" : "miss"}`}>
      <span className="hero-icon">{catchAll ? <Asterisk size={22} /> : l.status === "unverified" ? <Clock size={22} /> : <X size={22} strokeWidth={3} />}</span>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{catchAll ? "Catch-all server" : STATUS_LABEL[l.status]}</div>
        <div className="muted">{REASON_LABEL[l.reason ?? ""] ?? ""}</div>
      </div>
    </div>
  );
}

function DomainIntel({ d }: { d: DomainState }) {
  return (
    <div className="panel rise" style={{ ["--i" as string]: 2 }}>
      <div className="panel-head">
        <h2 className="panel-title">
          <Globe size={15} /> Domain intel
        </h2>
        <span className="panel-sub mono">{d.domain}</span>
      </div>
      <div className="panel-body stat-inline">
        <div>
          <span className="k">Status</span>
          <span style={{ marginTop: 4 }}>
            <Chip status={d.status === "valid" ? "found" : d.status} />
          </span>
        </div>
        <div>
          <span className="k">Company pattern</span>
          <span className="v mono" style={{ fontSize: 15 }}>
            {d.pattern ? PATTERN_LABEL[d.pattern] : "–"}
          </span>
        </div>
        <div>
          <span className="k">Last checked</span>
          <span className="v" style={{ fontSize: 15 }}>
            {d.checkedAt ? <Ago at={String(d.checkedAt)} /> : "–"}
          </span>
        </div>
      </div>
    </div>
  );
}
