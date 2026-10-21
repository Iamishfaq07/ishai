import { Link } from "react-router-dom";
import type { ApplySetup } from "@orbit/types";
import { cx } from "@orbit/ui";
import { linkButton } from "../links";
import { sendsItself } from "./model";

const HOSTED_SITES = "Greenhouse · Lever · Ashby · Workday · SmartRecruiters · Workable · Recruitee";

/**
 * How this account's approved applications are sent, inside Orbit with nothing to install: Orbit's hosted worker
 * sends supported employer forms, or (where hosted applying isn't on) each one waits in Needs you as a ready-to-send
 * kit. Orbit Business applications are always sent by Orbit. Accounts still in browser mode with an active extension
 * keep it; the extension is no longer offered here.
 */
export function ApplyEngine({ setup, preview = false }: { setup: ApplySetup; preview?: boolean }) {
  const hosted = setup.execution === "hosted" && setup.hosted_enabled;
  const title = hosted
    ? preview ? "Orbit sends your applications for you" : setup.hosted_online ? "Orbit is sending your applications" : "Orbit will send your applications shortly"
    : sendsItself(setup) ? "Your connected browser is sending applications" : "Orbit prepares each application, you send it";
  const body = hosted
    ? setup.hosted_online || preview
      ? "Supported employer forms are filled and sent from Orbit's servers, even with Orbit closed. Your approved answers, limits, quiet hours and review mode apply to every one."
      : "Your setup is saved. Orbit's application service is starting up, and approved applications wait safely until it is online."
    : sendsItself(setup)
      ? "Your connected browser keeps applying while it is open. Your approved answers, limits and review mode still apply."
      : "Each approved application waits in Needs you with its answers, cover letter and tailored resume ready. Open the employer form, paste and upload, then mark it applied. Nothing to install.";
  return <div role="status" data-testid="apply-engine" data-mode={hosted ? "hosted" : sendsItself(setup) ? "browser" : "send-yourself"}
    className={cx("rounded-xl border p-4 text-sm", "border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-100")}>
    <p className="font-semibold">{title}</p>
    <p className="mt-1">{body}</p>
    {hosted && <p className="mt-2 text-xs">{HOSTED_SITES}. A login, verification code, human check or missing answer comes back to you.</p>}
    {!preview && <Link to="/jobs/auto-apply" className={cx(linkButton("secondary", "sm"), "mt-3 inline-flex")}>Manage auto-apply</Link>}
  </div>;
}
