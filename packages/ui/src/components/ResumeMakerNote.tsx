import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import { FileText } from "../icons";
import { cx, focusRing } from "./cx";

/**
 * Under the desktop setup's documents: Orbit Resume AI lives on the web, so say how the best resume scores for
 * ATS software (or that none exists yet) and open it in the browser.
 */
export function ResumeMakerNote({
  api,
  onOpen,
  className,
}: {
  api: Pick<ApiClient, "listResumes">;
  onOpen: () => void;
  className?: string;
}) {
  const [best, setBest] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    api
      .listResumes()
      .then((list) => setBest(list.length ? Math.max(...list.map((r) => r.score)) : null))
      .catch(() => setBest(undefined));
  }, [api]);
  if (best === undefined) return null;
  return (
    <p className={cx("flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400", className)}>
      <FileText className="mt-px h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
      <span>
        {best === null
          ? "Resume AI: see how ATS software scores your resume, and fix it until it passes. "
          : `Resume AI: your best resume scores ${best}/100 for ATS software. `}
        <button
          type="button"
          onClick={onOpen}
          className={cx("font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
        >
          {best === null ? "Build one" : best >= 80 ? "Open" : "Improve it"}
        </button>
      </span>
    </p>
  );
}
