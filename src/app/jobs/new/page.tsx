"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { FileSpreadsheet, Play, Upload } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { n } from "@/components/format";

type Parsed = { name: string; headers: string[]; rows: Record<string, string>[] };
type Mapping = { first: string; last: string; domain: string };

const CHUNK = 2000;

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

export default function NewJobPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [map, setMap] = useState<Mapping>({ first: "", last: "", domain: "" });
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !res.data.length) {
          setError("That file has no rows or no header line.");
          return;
        }
        setParsed({ name: file.name, headers, rows: res.data });
        setMap(guess(headers));
        setName(file.name.replace(/\.csv$/i, ""));
      },
      error: (e) => setError(e.message),
    });
  }

  async function start() {
    if (!parsed) return;
    setError(null);
    try {
      setBusy("Creating job…");
      const post = async (url: string, body: unknown) => {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        return json;
      };
      const { id } = await post("/api/jobs", { name: name || parsed.name, columns: parsed.headers });
      let dup = 0;
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setBusy(`Uploading ${n(Math.min(i + CHUNK, parsed.rows.length))} / ${n(parsed.rows.length)} rows…`);
        const rows = parsed.rows.slice(i, i + CHUNK).map((r) => ({
          first: r[map.first] ?? "",
          last: map.last ? (r[map.last] ?? "") : "",
          domain: r[map.domain] ?? "",
          input: r,
        }));
        const res = await post(`/api/jobs/${id}/rows`, { start: i + 1, rows });
        dup += res.duplicates;
      }
      await post(`/api/jobs/${id}/start`, {});
      router.push(`/jobs/${id}${dup ? `?dupes=${dup}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const preview = parsed?.rows.slice(0, 5) ?? [];
  const ready = parsed && map.first && map.domain && !busy;

  return (
    <>
      <Topbar title="Upload CSV" crumb="Jobs" />
      <div className="content">
        {!parsed && (
          <label
            className={`dropzone${over ? " is-over" : ""}`}
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
            <Upload size={22} strokeWidth={1.5} />
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>Drop a CSV here, or click to choose one</span>
            <span>Needs a first name, last name and company domain (or website) column.</span>
            <input
              ref={fileInput}
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
            <section className="card">
              <div className="card-head">
                <FileSpreadsheet size={16} strokeWidth={1.5} style={{ color: "var(--faint)" }} />
                <h2>{parsed.name}</h2>
                <p className="num">
                  {n(parsed.rows.length)} rows · {parsed.headers.length} columns
                </p>
                <button
                  className="btn btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => {
                    setParsed(null);
                    setBusy(null);
                  }}
                  disabled={!!busy}
                >
                  Choose another file
                </button>
              </div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="field" style={{ maxWidth: 420 }}>
                  <label htmlFor="jobname">Job name</label>
                  <input id="jobname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="map-grid">
                  {(
                    [
                      ["first", "First name column", true],
                      ["last", "Last name column", false],
                      ["domain", "Domain / website column", true],
                    ] as const
                  ).map(([key, label, required]) => (
                    <div className="field" key={key}>
                      <label htmlFor={`map-${key}`}>
                        {label}
                        {required ? "" : " (optional)"}
                      </label>
                      <select
                        id={`map-${key}`}
                        className="select"
                        value={map[key]}
                        onChange={(e) => setMap({ ...map, [key]: e.target.value })}
                      >
                        <option value="">{required ? "Choose a column…" : "None"}</option>
                        {parsed.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>First name</th>
                    <th>Last name</th>
                    <th>Domain</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td className="faint num">{i + 1}</td>
                      <td>{map.first ? r[map.first] : <span className="faint">—</span>}</td>
                      <td>{map.last ? r[map.last] : <span className="faint">—</span>}</td>
                      <td>{map.domain ? r[map.domain] : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <span className="muted">
                Each person costs 1–9 checks. After one person at a company is found, the rest usually cost 1 check each.
              </span>
              <span className="spacer" />
              {busy && <span className="status pending">{busy}</span>}
              <button className="btn btn-primary" onClick={start} disabled={!ready}>
                <Play size={14} strokeWidth={1.75} /> Start finding emails
              </button>
            </div>
          </>
        )}
        {error && <div className="notice err">{error}</div>}
      </div>
    </>
  );
}
