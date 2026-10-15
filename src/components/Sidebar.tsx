"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign, FileUp, ListChecks, Search } from "lucide-react";
import { WorkerStatus } from "./WorkerStatus";

const links = [
  { href: "/", label: "Find an email", icon: Search, match: (p: string) => p === "/" },
  { href: "/jobs", label: "Jobs", icon: ListChecks, match: (p: string) => p === "/jobs" || /^\/jobs\/(?!new)/.test(p) },
  { href: "/jobs/new", label: "Upload CSV", icon: FileUp, match: (p: string) => p === "/jobs/new" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <AtSign size={14} strokeWidth={2} />
        </span>
        Email Finder
      </div>
      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {links.map(({ href, label, icon: Icon, match }) => (
          <Link key={href} href={href} className={`nav-link${match(pathname) ? " is-on" : ""}`}>
            <Icon size={16} strokeWidth={1.5} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <WorkerStatus />
      </div>
    </aside>
  );
}
