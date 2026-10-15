import { NextResponse, type NextRequest } from "next/server";

// Password protection for the whole app (HTTP Basic auth).
// Set APP_PASSWORD (and optionally APP_USER, default "admin"). Unset = open (local dev only).
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.APP_USER || "admin";

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (u === user && rest.join(":") === password) return NextResponse.next();
    } catch {
      // malformed header: fall through to the challenge
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Email Finder", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
