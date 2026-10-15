"use client";
import { useEffect, useState } from "react";
import { Globe, Search } from "lucide-react";
import type { DomainView } from "@/lib/views";
import { usePoll } from "@/components/usePoll";
import { Ago, Chip, PageHead, Pager, Seg } from "@/components/ui";
import { n, PATTERN_LABEL } from "@/components/format";

const TABS = [
  ["", "All"],
  ["valid", "Proven pattern"],
  ["catch_all", "Catch-all"],
  ["not_found", "Parked"],
  ["no_mx", "No mail server"],
  ["unknown", "Not checked"],
] as const;

export default function DomainsPage() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = usePoll<{ rows: DomainView[]; counts: Record<string, number> }>(
    `/api/domains?page=${page}${tab ? `&status=${tab}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    5000,
  );
  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((s, v) => s + v, 0);
  const shown = tab ? (counts[tab] ?? 0) : all;

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <Globe size={13} /> Domains
          </>
        }
        title={
          <>
            What every company <i>looks like.</i>
          </>
        }
        sub="Each company's proven email pattern, catch-all servers and parked domains. Later uploads reuse this, so known companies cost one check per person."
      />

      <div className="toolbar rise" style={{ ["--i" as string]: 1 }}>
        <Seg
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(0);
          }}
          items={TABS.map(([value, label]) => ({ value, label, count: value ? (counts[value] ?? 0) : all }))}
        />
        <span className="spacer" />
        <div className="search" style={{ width: 240 }}>
          <Search size={14} />
          <input className="input" placeholder="Search domains" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="tbl-wrap rise" style={{ ["--i" as string]: 2 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Status</th>
              <th>Company pattern</th>
              <th className="r">People</th>
              <th className="r">Found</th>
              <th style={{ width: 160 }}>Hit rate</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((d) => {
              const rate = d.people ? (d.found / d.people) * 100 : 0;
              return (
                <tr key={d.domain}>
                  <td className="mono" style={{ fontWeight: 500 }}>
                    {d.domain}
                  </td>
                  <td>
                    <Chip status={d.status === "valid" ? "found" : d.status === "not_found" ? "not_found" : d.status === "unknown" ? "skipped" : d.status}>
                      {TABS.find(([k]) => k === d.status)?.[1]}
                    </Chip>
                  </td>
                  <td>{d.pattern ? <span className="tag">{PATTERN_LABEL[d.pattern]}</span> : <span className="faint">—</span>}</td>
                  <td className="r num">{n(d.people)}</td>
                  <td className={`r num${d.found ? "" : " zero"}`} style={{ color: d.found ? "var(--ok-ink)" : undefined }}>
                    {n(d.found)}
                  </td>
                  <td>
                    <div className="row">
                      <div className="hbar" style={{ gridTemplateColumns: "1fr", flex: 1 }}>
                        <span className="track">
                          <i style={{ width: `${rate}%` }} />
                        </span>
                      </div>
                      <span className="num muted" style={{ width: 36, textAlign: "right", fontSize: 12 }}>
                        {Math.round(rate)}%
                      </span>
                    </div>
                  </td>
                  <td className="muted">{d.checked_at ? <Ago at={d.checked_at} /> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <div className="empty">No domains here yet.</div>}
      </div>
      <Pager page={page} pages={Math.ceil(shown / 50)} onPage={setPage} />
    </div>
  );
}
