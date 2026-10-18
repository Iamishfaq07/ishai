// Orbit for Business (D82): /business/invite/:token, the link in an invite email. Signed out, sign in (or sign up)
// with the invited address first; then join.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { BizInviteLookup } from "@orbit/types";
import { Button, Callout, EmptyState, buttonClass } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { biz } from "./api";
import { ROLE_HINT, ROLE_LABEL, companyPath } from "./model";
import { errorText } from "./ui";

export function InvitePage() {
  const { token = "" } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<BizInviteLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle("Join a company on Orbit for Business", null, true);
  useEffect(() => {
    biz.lookupInvite(token).then(setInvite).catch((e: unknown) => setError(errorText(e)));
  }, [token]);
  const here = `/business/invite/${encodeURIComponent(token)}`;
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-5 py-16">
      {error ? (
        <EmptyState kind="no-results" title="This invite doesn't work" body={error} />
      ) : !invite ? (
        <p role="status" className="text-sm text-zinc-500">
          Checking the invite…
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            {invite.company_logo_url && <img src={invite.company_logo_url} alt="" width={48} height={48} className="h-12 w-12 rounded-xl border border-zinc-200 object-contain dark:border-white/10" />}
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Orbit for Business</p>
              <h1 className="font-display text-2xl font-semibold tracking-tight">Join {invite.company_name}</h1>
            </div>
          </div>
          <p className="text-sm">
            You're invited as <strong>{ROLE_LABEL[invite.role]}</strong>: {ROLE_HINT[invite.role].toLowerCase()} The invite is for {invite.email_masked}.
          </p>
          {invite.accepted ? (
            <Callout tone="info">This invite was already used.</Callout>
          ) : invite.expired ? (
            <Callout tone="warning">This invite has expired. Ask {invite.company_name} to send a new one.</Callout>
          ) : loading ? null : !user ? (
            <div className="flex flex-wrap gap-2">
              <Link to="/login" state={{ from: here }} className={buttonClass("primary")}>
                Sign in to join
              </Link>
              <Link to="/register" state={{ from: here }} className={buttonClass("secondary")}>
                Create an account
              </Link>
            </div>
          ) : (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const c = await biz.acceptInvite(token);
                  navigate(companyPath(c.id));
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Join {invite.company_name}
            </Button>
          )}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Your own Orbit (practice, resumes, sessions) stays yours: a company never sees it.</p>
        </div>
      )}
    </main>
  );
}
