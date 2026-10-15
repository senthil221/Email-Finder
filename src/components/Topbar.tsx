import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ title, crumb, children }: { title: ReactNode; crumb?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      {crumb && (
        <>
          <span className="crumb">{crumb}</span>
          <span className="crumb">/</span>
        </>
      )}
      <h1>{title}</h1>
      <div className="topbar-tools">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
