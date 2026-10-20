import { Link, useLocation } from "react-router-dom";
import { cx, focusRing } from "@orbit/ui";
import { useAuth } from "../lib/auth";

/** Navigation only: company permissions and membership are checked by the destination. */
export function WorkspaceSwitch() {
  const business = useLocation().pathname.startsWith("/business");
  const { user } = useAuth();
  return <Link to={business ? "/" : user ? "/business/app" : "/business"}
    aria-label={`Switch to ${business ? "Personal" : "Business"} Orbit`}
    title={`Switch to ${business ? "Personal" : "Business"} Orbit`}
    className={cx("inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 px-2.5 text-xs font-semibold transition-colors hover:bg-indigo-50 dark:border-white/15 dark:hover:bg-white/5", focusRing)}>
    <span aria-hidden="true">⇄</span> {business ? "Personal" : "Business"}
  </Link>;
}
