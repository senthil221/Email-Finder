import Link from "next/link";
import { FileUp } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { JobsTable } from "@/components/JobsTable";

export default function JobsPage() {
  return (
    <>
      <Topbar title="Jobs">
        <Link href="/jobs/new" className="btn btn-primary btn-sm">
          <FileUp size={14} strokeWidth={1.75} /> Upload CSV
        </Link>
      </Topbar>
      <div className="content">
        <JobsTable />
      </div>
    </>
  );
}
