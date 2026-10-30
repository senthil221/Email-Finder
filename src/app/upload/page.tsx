"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { ArrowLeft, Check, Download, FileSpreadsheet, Upload } from "lucide-react";
import { PageHead, Progress } from "@/components/ui";
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

const FIELDS = [
  ["first", "First name", true],
  ["last", "Last name", false],
  ["domain", "Company website", true],
  ["linkedin", "LinkedIn URL", false],
] as const;

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
      toast(`${name || parsed.name} started: ${n(parsed.rows.length - dup)} people to check`);
      router.push(`/jobs/${id}`);
    } catch (e) {
      setError(`Upload stopped (${(e as Error).message}). The rows sent so far are saved: press Resume upload to continue.`);
      setProgress(null);
    }
  }

  const step = !parsed ? 1 : progress === null ? 2 : 3;
  const sample = parsed?.rows[0] ?? {};

  return (
    <div className="page">
      <PageHead title="Upload a list" sub="A CSV with first name, last name and the company website. Your own columns are kept in the download.">
        <button className="btn" onClick={sampleCsv}>
          <Download size={16} /> Example CSV
        </button>
      </PageHead>

      <ol className="steps" aria-label="Steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {["Choose a file", "Match the columns", "Start"].map((label, i) => (
          <li key={label} style={{ display: "contents" }}>
            {i > 0 && <span className="line" aria-hidden="true" />}
            <span className={`st${step === i + 1 ? " is-on" : step > i + 1 ? " is-done" : ""}`} aria-current={step === i + 1 ? "step" : undefined}>
              <b>{step > i + 1 ? <Check size={12} strokeWidth={3} /> : i + 1}</b>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {!parsed && (
        <label
          className={`drop${over ? " is-over" : ""}`}
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
          <Upload size={28} strokeWidth={1.5} className="muted" />
          <h3>{over ? "Drop it here" : "Drag your CSV here"}</h3>
          <p className="muted">or click to choose a file. Large lists are fine.</p>
          <span className="btn btn-sm" style={{ marginTop: 6 }}>
            <FileSpreadsheet size={15} /> Choose file
          </span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </label>
      )}

      {parsed && (
        <>
          <section className="card">
            <div className="card-head">
              <FileSpreadsheet size={17} className="muted" />
              <h2>{parsed.name}</h2>
              <span className="sub num">
                {n(parsed.rows.length)} rows · {parsed.headers.length} columns
              </span>
              <div className="tools">
                <button className="btn btn-sm" onClick={() => setParsed(null)} disabled={progress !== null || !!resume}>
                  <ArrowLeft size={14} /> Choose another file
                </button>
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor="jobname">List name</label>
                <input id="jobname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="map-grid">
                {FIELDS.map(([key, label, required]) => (
                  <div key={key} className="field">
                    <label htmlFor={`map-${key}`}>
                      {label} {!required && <span className="faint" style={{ fontWeight: 400 }}>(optional)</span>}
                    </label>
                    <select id={`map-${key}`} className="select" value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
                      <option value="">{required ? "Choose a column…" : "None"}</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="eg">e.g. {map[key] ? sample[map[key]] || "—" : "—"}</span>
                  </div>
                ))}
              </div>
              {est && (
                <div className="notice info">
                  <span>
                    <b>{n(est.valid)}</b> people at <b>{n(est.companies)}</b> companies: about {n(est.low)}–{n(est.high)} MailTester checks, roughly{" "}
                    {fmtEta(est.minutes)}. One person per company goes first; once their address is proven, the rest usually take a single check.
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>First rows</h2>
              <span className="sub">How your file will be read</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="r" style={{ width: 56 }}>
                      #
                    </th>
                    <th>First name</th>
                    <th>Last name</th>
                    <th>Company website</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td className="r num faint">{i + 1}</td>
                      <td>{map.first ? r[map.first] : <span className="faint">—</span>}</td>
                      <td>{map.last ? r[map.last] : <span className="faint">—</span>}</td>
                      <td>{map.domain ? cleanDomain(r[map.domain]) || <span className="faint">—</span> : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="card card-body toolbar">
            {progress !== null ? (
              <div className="row" style={{ flex: 1, gap: 12 }}>
                <span className="spinner" />
                <span>Uploading rows… keep this tab open</span>
                <div style={{ flex: 1 }}>
                  <Progress pct={progress} />
                </div>
                <span className="num muted">{Math.round(progress)}%</span>
              </div>
            ) : (
              <span className="muted">{!map.first || !map.domain ? "Choose the first name and company website columns to continue." : "Ready when you are."}</span>
            )}
            <span className="spacer" />
            <button className="btn btn-primary btn-lg" onClick={launch} disabled={!map.first || !map.domain || progress !== null}>
              {resume ? `Resume upload (row ${n(resume.next + 1)})` : `Start finding${est ? ` ${n(est.valid)} emails` : ""}`}
            </button>
          </div>
        </>
      )}
      {error && <div className="notice err">{error}</div>}
    </div>
  );
}
