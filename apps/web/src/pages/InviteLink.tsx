import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { keepRef } from "../lib/referral";

/**
 * `/r/<code>`: an invite link, or a creator's or campus's. The code is kept for the sign-up (lib/referral.ts), then on
 * to create an account. Someone already signed in goes to Plan & billing with it, where a code can be entered before
 * a first purchase.
 */
export function InviteLinkPage() {
  const { code } = useParams();
  const { user, loading } = useAuth();
  const [kept] = useState(() => keepRef(code));
  if (loading) return null;
  if (user) return <Navigate to={kept ? `/billing?code=${encodeURIComponent(kept)}` : "/billing"} replace />;
  return <Navigate to="/register" replace />;
}
