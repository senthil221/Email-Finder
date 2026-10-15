// A fake MailTester Ninja for local testing, so no real credits are spent.
// Rules: domains containing "catchall" -> Catch-All, "nomx" -> No Mx, "slow" -> Timeout.
// Mailboxes added with GET /register?email=... make their domain accept only those.
// Other domains accept first.last style addresses (two parts, 2+ letters each).
// Run: npm run dev:mtn   then start the worker with MTN_BASE_URL=http://127.0.0.1:4010/ninja
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4010);
const boxes = new Set<string>();
const registered = new Set<string>();

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const email = (url.searchParams.get("email") ?? "").toLowerCase();
  const [local, domain = ""] = email.split("@");
  res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/register") {
    boxes.add(email);
    registered.add(domain);
    return res.end(JSON.stringify({ ok: true, mailboxes: boxes.size }));
  }

  let code = "ko";
  let message = "Rejected";
  if (!url.searchParams.get("key")) message = "Invalid Key";
  else if (domain.includes("nomx")) message = "No Mx";
  else if (domain.includes("catchall")) [code, message] = ["mb", "Catch-All"];
  else if (domain.includes("slow")) [code, message] = ["mb", "Timeout"];
  else if (registered.has(domain) ? boxes.has(email) : /^[a-z]{2,}\.[a-z]{2,}$/.test(local)) [code, message] = ["ok", "Accepted"];
  setTimeout(() => {
    res.end(JSON.stringify({ email, user: local, domain, mx: `mx.${domain}`, code, message, connections: 1 }));
  }, 80 + Math.random() * 150);
}).listen(port, "127.0.0.1", () => console.log(`mock MailTester on http://127.0.0.1:${port}/ninja`));
