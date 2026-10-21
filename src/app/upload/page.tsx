"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { ArrowLeft, Check, Download, FileSpreadsheet, Rocket, UploadCloud } from "lucide-react";
import { Bar, PageHead } from "@/components/ui";
import { toast } from "@/components/Shell";
import { fmtEta, n } from "@/components/format";

type Parsed = { name: string; headers: string[]; rows: Record<string, string>[] };
type Mapping = { first: string; last: string; domain: string; linkedin: string };

const CHUNK = 2000;
const CHECKS_PER_MIN = 132; // MailTester pace: 22 per 10s

function guess(headers: string[]): Mapping {
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const h = headers.find((x) => re.test(x));
      if (h) return h;
    }
    return "";
  };
  return {
    first: find(/^first[\s_-]*name$/i, /first/i, /^fname$/i, /given/i),
    last: find(/^last[\s_-]*name$/i, /last/i, /surname/i, /^lname$/i, /family/i),
    domain: find(/domain/i, /website/i, /^url$/i, /web/i, /site/i, /^(?!.*linkedin).*url/i),
    linkedin: find(/linkedin/i, /^li[s_-]*url$/i, /profile[s_-]*url/i),
  };
}

const cleanDomain = (v: string) =>
  (v || "").trim().toLowerCase().replace(/^.*@/, "").replace(/^[a-z]+:\/\//, "").split(/[/?#\s]/)[0].replace(/^www\d*\./, "");

function sampleCsv() {
  const csv = "First Name,Last Name,Website,Title\nAndrew,Deepak,acme.com,Head of Sales\nPriya,Raman,https://www.example.in,CTO\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "email-finder-template.csv";
  a.click();
}

export default function UploadPage() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [map, setMap] = useState<Mapping>({ first: "", last: "", domain: "", linkedin: "" });
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Where a stopped upload picks up again: the job it created and the next row. */
  const [resume, setResume] = useState<{ id: string; next: number; dup: number } | null>(null);

  function load(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !res.data.length) return setError("That file has no rows or no header line.");
        setParsed({ name: file.name, headers, rows: res.data });
        setMap(guess(headers));
        setName(file.name.replace(/\.csv$/i, ""));
      },
      error: (e) => setError(e.message),
    });
  }

  const est = useMemo(() => {
    if (!parsed || !map.first || !map.domain) return null;
    const domains = new Map<string, number>();
    let valid = 0;
    for (const r of parsed.rows) {
      const d = cleanDomain(r[map.domain]);
      if (!d.includes(".") || !(r[map.first] || "").trim()) continue;
      valid++;
      domains.set(d, (domains.get(d) ?? 0) + 1);
    }
    // Scout: ~5 checks to prove a company; everyone after ~1.3 checks.
    const companies = domains.size;
    const low = companies + (valid - companies);
    const high = Math.round(companies * 6 + (valid - companies) * 1.5);
    return { valid, companies, low, high, minutes: (low + high) / 2 / CHECKS_PER_MIN };
  }, [parsed, map]);

  // Warn before closing the tab mid-upload: the job only starts once every row is in.
  useEffect(() => {
    if (progress === null) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [progress]);

  async function launch() {
    if (!parsed) return;
    setError(null);
    try {
      setProgress(resume ? (resume.next / parsed.rows.length) * 100 : 0);
      // Network blips and 5xx are retried; re-sending a chunk is safe (duplicates are skipped).
      const post = async (url: string, body: unknown) => {
        for (let attempt = 1; ; attempt++) {
          let res: Response;
          try {
            res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          } catch (e) {
            if (attempt >= 5) throw e;
            await new Promise((r) => setTimeout(r, attempt * 3000));
            continue;
          }
          const json = await res.json().catch(() => ({}));
          if (res.ok) return json;
          if (res.status < 500 || attempt >= 5) throw new Error(json.error ?? res.statusText);
          await new Promise((r) => setTimeout(r, attempt * 3000));
        }
      };
      const id = resume?.id ?? (await post("/api/jobs", { name: name || parsed.name, columns: parsed.headers })).id;
      let dup = resume?.dup ?? 0;
      for (let i = resume?.next ?? 0; i < parsed.rows.length; i += CHUNK) {
        setResume({ id, next: i, dup });
        const rows = parsed.rows.slice(i, i + CHUNK).map((r) => ({
          first: r[map.first] ?? "",
          last: map.last ? (r[map.last] ?? "") : "",
          domain: r[map.domain] ?? "",
          linkedin: map.linkedin ? (r[map.linkedin] ?? "") : undefined,
          input: r,
        }));
        const res = await post(`/api/jobs/${id}/rows`, { start: i + 1, rows });
        dup += res.duplicates;
        setProgress(Math.min(100, ((i + CHUNK) / parsed.rows.length) * 100));
      }
      await post(`/api/jobs/${id}/start`, {});
      setResume(null);
      toast(`Launched ${name || parsed.name}: ${n(parsed.rows.length - dup)} people queued`);
      router.push(`/jobs/${id}`);
    } catch (e) {
      setError(`Upload stopped (${(e as Error).message}). Your rows so far are saved: press Resume upload to continue.`);
      setProgress(null);
    }
  }

  const step = !parsed ? 1 : progress === null ? 2 : 3;
  const sample = parsed?.rows[0] ?? {};

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            <UploadCloud size={13} /> Bulk upload
          </>
        }
        title={
          <>
            Drop a list. <i>Get inboxes.</i>
          </>
        }
        sub="Any CSV with a first name, last name and company website. Your original columns are kept in the export."
      >
        <button className="btn" onClick={sampleCsv}>
          <Download size={15} /> Template CSV
        </button>
      </PageHead>

      <div className="steps rise" style={{ ["--i" as string]: 1 }}>
        {["Upload", "Map columns", "Launch"].map((label, i) => (
          <div key={label} style={{ display: "contents" }}>
            {i > 0 && <span className="step-line" />}
            <span className={`step${step === i + 1 ? " is-on" : step > i + 1 ? " is-done" : ""}`}>
              <b>{step > i + 1 ? <Check size={12} strokeWidth={3} /> : i + 1}</b>
              {label}
            </span>
          </div>
        ))}
      </div>

      {!parsed && (
        <label
          className={`drop rise${over ? " is-over" : ""}`}
          style={{ ["--i" as string]: 2 }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
        >
          <span className="drop-icon">
            <UploadCloud size={28} strokeWidth={1.6} />
          </span>
          <h3>{over ? "Release to upload" : "Drop your CSV here"}</h3>
          <p>or click to browse · up to hundreds of thousands of rows</p>
          <span className="btn btn-sm" style={{ marginTop: 6 }}>
            <FileSpreadsheet size={14} /> Choose file
          </span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </label>
      )}

      {parsed && (
        <>
          <section className="panel glow rise" style={{ ["--i" as string]: 2 }}>
            <div className="panel-head">
              <h2 className="panel-title">
                <FileSpreadsheet size={15} /> {parsed.name}
              </h2>
              <span className="panel-sub num">
                {n(parsed.rows.length)} rows · {parsed.headers.length} columns
              </span>
              <div className="panel-tools">
                <button className="btn btn-ghost btn-sm" onClick={() => setParsed(null)} disabled={progress !== null || !!resume}>
                  <ArrowLeft size={13} /> Another file
                </button>
              </div>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor="jobname">Job name</label>
                <input id="jobname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="map-grid">
                {(
                  [
                    ["first", "First name", true],
                    ["last", "Last name", false],
                    ["domain", "Domain / website", true],
                    ["linkedin", "LinkedIn URL", false],
                  ] as const
                ).map(([key, label, required]) => (
                  <div key={key} className={`map-card${map[key] ? " ok" : ""}`}>
                    <div className="mc-head">
                      {map[key] ? <Check size={14} style={{ color: "var(--ok-ink)" }} /> : <span className="live-dot warn" style={{ width: 7, height: 7 }} />}
                      {label}
                      {!required && <span className="faint" style={{ fontWeight: 400 }}>optional</span>}
                    </div>
                    <select className="select" value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })} aria-label={`${label} column`}>
                      <option value="">{required ? "Choose a column…" : "None"}</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="mc-sample">e.g. {map[key] ? sample[map[key]] || "—" : "—"}</span>
                  </div>
                ))}
              </div>

              {est && (
                <div className="est">
                  <div>
                    <div className="k">People to find</div>
                    <div className="v">{n(est.valid)}</div>
                  </div>
                  <div>
                    <div className="k">Companies (scouts)</div>
                    <div className="v">{n(est.companies)}</div>
                  </div>
                  <div>
                    <div className="k">Estimated checks</div>
                    <div className="v">
                      {n(est.low)}–{n(est.high)}
                    </div>
                  </div>
                  <div>
                    <div className="k">Estimated time</div>
                    <div className="v">~{fmtEta(est.minutes)}</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="tbl-wrap rise" style={{ ["--i" as string]: 3 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>First name</th>
                  <th>Last name</th>
                  <th>Domain</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    <td className="faint num">{i + 1}</td>
                    <td>{map.first ? r[map.first] : <span className="faint">—</span>}</td>
                    <td>{map.last ? r[map.last] : <span className="faint">—</span>}</td>
                    <td className="mono">{map.domain ? cleanDomain(r[map.domain]) || <span className="faint">—</span> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel rise" style={{ ["--i" as string]: 4 }}>
            <div className="panel-body toolbar">
              {progress !== null ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="spinner" />
                  <span>Uploading rows…</span>
                  <Bar pct={progress} live style={{ flex: 1 }} />
                  <span className="num muted">{Math.round(progress)}%</span>
                </div>
              ) : (
                <span className="muted">One person per company goes first. Once their email is proven, everyone else usually costs a single check.</span>
              )}
              <span className="spacer" />
              <button className="btn btn-primary btn-lg" onClick={launch} disabled={!map.first || !map.domain || progress !== null}>
                <Rocket size={16} /> {resume ? `Resume upload (row ${n(resume.next + 1)})` : `Launch ${est ? n(est.valid) : ""} lookups`}
              </button>
            </div>
          </div>
        </>
      )}
      {error && <div className="notice err">{error}</div>}
    </div>
  );
}
