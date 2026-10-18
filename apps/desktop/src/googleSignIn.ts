/**
 * Continue with Google on the sign-in screen (D81): idle → waiting for the browser (with Cancel) → finishing (the
 * exchange) → signed in, the authenticator step, or a message. The browser half is google_sign_in.rs; this is the
 * window's half, kept apart from the screen so it can be tested.
 */
import type { AuthResponse, TwoFactorChallenge } from "@orbit/types";
import type { GoogleCode } from "./native";

export type GoogleStep =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "finishing" }
  | { kind: "error"; message: string };

export type GoogleOutcome =
  | { kind: "signed-in"; auth: AuthResponse & { access_token: string } }
  | { kind: "two-factor"; challenge: string }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export interface GoogleDeps {
  /** Opens the browser and waits for its code (native.googleSignIn). */
  open: (apiUrl: string) => Promise<GoogleCode>;
  /** POST /v1/auth/desktop/exchange. */
  exchange: (code: string, verifier: string) => Promise<AuthResponse | TwoFactorChallenge>;
}

const GENERIC = "Google sign-in didn't finish. Try again, or use your email.";

/** The API's error codes (google.py), the listener's own, as a person reads them. Mirrors the web's GOOGLE_ERROR. */
const MESSAGES: Partial<Record<string, string>> = {
  timeout: "Google sign-in timed out. Try again when you're ready.",
  denied: "Google sign-in was cancelled in the browser.",
  google: GENERIC,
  private: "This Orbit server is private. Ask the owner to add your email.",
  suspended: "This account is suspended.",
  unverified: "That Google account doesn't have a confirmed email. Use another, or sign up with email.",
  server: "Something went wrong on our side while signing you in. Try again in a minute.",
  busy: "Too many sign-in attempts from your network. Wait a minute, then try again.",
  google_off: "Google sign-in isn't available right now. Sign in with your email instead.",
};

/** Words for whatever the listener or the exchange rejected with. */
export function googleErrorText(err: unknown): string {
  if (typeof err === "string") {
    const known = Object.prototype.hasOwnProperty.call(MESSAGES, err) ? MESSAGES[err] : undefined;
    if (known) return known;
    if (err.startsWith("failed: ")) {
      console.warn("Google sign-in:", err);
      return err.includes("browser")
        ? "Orbit couldn't open your browser. Check that you have a default browser set, then try again."
        : "Google sign-in couldn't start on this PC. Try again, or use your email.";
    }
    return GENERIC;
  }
  // The exchange's own answer ("That sign-in expired or was already used…", "This account is suspended…").
  if (err instanceof Error && err.message) return err.message;
  return GENERIC;
}

/** Runs one sign-in, telling `onStep` where it is. Never throws: the outcome says how it ended. */
export async function signInWithGoogle(
  deps: GoogleDeps,
  apiUrl: string,
  onStep: (step: GoogleStep) => void,
): Promise<GoogleOutcome> {
  onStep({ kind: "waiting" });
  let got: GoogleCode;
  try {
    got = await deps.open(apiUrl);
  } catch (err) {
    // "duplicate": a repeat of an attempt that already ended (google_sign_in.rs); nothing to say.
    if (err === "cancelled" || err === "duplicate") {
      onStep({ kind: "idle" });
      return { kind: "cancelled" };
    }
    const message = googleErrorText(err);
    onStep({ kind: "error", message });
    return { kind: "failed", message };
  }
  onStep({ kind: "finishing" });
  try {
    const res = await deps.exchange(got.code, got.verifier);
    if ("two_factor_required" in res) {
      onStep({ kind: "idle" });
      return { kind: "two-factor", challenge: res.challenge };
    }
    if (!res.access_token) throw new Error("Sign-in didn't finish. Please try again.");
    onStep({ kind: "idle" });
    return { kind: "signed-in", auth: { ...res, access_token: res.access_token } };
  } catch (err) {
    const message = googleErrorText(err);
    onStep({ kind: "error", message });
    return { kind: "failed", message };
  }
}
