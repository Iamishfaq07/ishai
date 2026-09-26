import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import { BookOpen } from "../icons";
import { cx, focusRing } from "./cx";

/**
 * Under a setup screen's documents: the story bank always comes along (it isn't picked per session), so say how
 * many stories live answers can use and link to where they're managed. Shared by web and desktop setup.
 */
export function StoryBankNote({
  api,
  onManage,
  className,
}: {
  api: Pick<ApiClient, "listStories">;
  onManage: () => void;
  className?: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    api
      .listStories()
      .then((s) => setCount(s.length))
      .catch(() => setCount(null));
  }, [api]);
  if (count === null) return null;
  return (
    <p className={cx("flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400", className)}>
      <BookOpen className="mt-px h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
      <span>
        {count > 0
          ? `Plus your story bank: ${count} ${count === 1 ? "story" : "stories"} for “Tell me about a time…” questions. `
          : "No stories in your story bank yet — real examples make behavioral answers yours. "}
        <button
          type="button"
          onClick={onManage}
          className={cx("font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
        >
          {count > 0 ? "Manage" : "Add stories"}
        </button>
      </span>
    </p>
  );
}
