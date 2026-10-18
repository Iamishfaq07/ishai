/**
 * Changes to the recorded answers (recorded.json stays exactly what the local server said):
 * - the demo account is the local server's first user, so it's its admin there: the films show a normal account;
 * - the support inbox and the admin counts are left out.
 */
type Rec = Record<string, { status: number; body: unknown } | unknown>;

export function patchRecorded(rec: Rec): Rec {
  const out: Rec = { ...rec };
  delete out.__meta;
  out["GET /v1/admin/status"] = { status: 200, body: { admin: false } };
  // The setup page's ready check asks the server if it's up.
  out["GET /health"] = { status: 200, body: { status: "ok", commit: null } };
  for (const k of Object.keys(out)) if (k.startsWith("GET /v1/admin/") && k !== "GET /v1/admin/status") out[k] = { status: 403, body: { detail: "Admins only" } };
  const me = out["GET /v1/auth/me"] as { body: Record<string, unknown> } | undefined;
  if (me) me.body = { ...me.body, email_verified: true };
  return out;
}
