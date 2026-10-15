"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { ArrowLeft, Check, Download, FileSpreadsheet, Rocket, UploadCloud } from "lucide-react";
import { Bar, PageHead } from "@/components/ui";
import { toast } from "@/components/Shell";
import { fmtEta, n } from "@/components/format";

type Parsed = { name: string; headers: string[]; rows: Record<string, string>[] };
type Mapping = { first: string; last: string; domain: string };

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
    domain: find(/domain/i, /website/i, /^url$/i, /web/i, /site/i, /url/i),
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
  const [map, setMap] = useState<Mapping>({ first: "", last: "", domain: "" });
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function launch() {
    if (!parsed) return;
    setError(null);
    try {
      setProgress(0);
      const post = async (url: string, body: unknown) => {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        return json;
      };
      const { id } = await post("/api/jobs", { name: name || parsed.name, columns: parsed.headers });
      let dup = 0;
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const rows = parsed.rows.slice(i, i + CHUNK).map((r) => ({
          first: r[map.first] ?? "",
          last: map.last ? (r[map.last] ?? "") : "",
          domain: r[map.domain] ?? "",
          input: r,
        }));
        const res = await post(`/api/jobs/${id}/rows`, { start: i + 1, rows });
        dup += res.duplicates;
        setProgress(Math.min(100, ((i + CHUNK) / parsed.rows.length) * 100));
      }
      await post(`/api/jobs/${id}/start`, {});
      toast(`Launched ${name || parsed.name}: ${n(parsed.rows.length - dup)} people queued`);
      router.push(`/jobs/${id}`);
    } catch (e) {
      setError((e as Error).message);
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
                <button className="btn btn-ghost btn-sm" onClick={() => setParsed(null)} disabled={progress !== null}>
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
                <Rocket size={16} /> Launch {est ? n(est.valid) : ""} lookups
              </button>
            </div>
          </div>
        </>
      )}
      {error && <div className="notice err">{error}</div>}
    </div>
  );
}
