import Link from "next/link";
import { redirect } from "next/navigation";
import { getPreviousRun } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ComparePrevPage({ params }: PageProps) {
  const { id } = await params;
  const previousRun = getPreviousRun(id);

  if (previousRun) {
    redirect(`/compare/${previousRun.id}/${id}`);
  }

  return (
    <div>
      <Link
        href={`/runs/${id}`}
        className="text-xs opacity-50 hover:opacity-100 mb-4 inline-block"
        style={{ color: "var(--sidebar-active)" }}
      >
        &larr; Back to Run
      </Link>
      <div
        className="rounded p-6 text-sm opacity-60 mt-4"
        style={{ border: "1px solid var(--border-color)" }}
      >
        No previous run to compare against.
      </div>
    </div>
  );
}
