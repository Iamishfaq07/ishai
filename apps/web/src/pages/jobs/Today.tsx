import { Navigate, useLocation } from "react-router-dom";
import { CareerHub } from "./CareerHub";

/** /jobs and /jobs/actions were the launchpad and daily actions; both now live on Today ("/"). The launchpad's
 *  focused panels (/jobs?work=… and ?start=1) stay here. */
export function JobsTodayPage() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  if (pathname.replace(/\/$/, "") === "/jobs/actions" || !(params.get("work") || params.get("start") === "1")) {
    return <Navigate to="/" replace />;
  }
  return <CareerHub />;
}
