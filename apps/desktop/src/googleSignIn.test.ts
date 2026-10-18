import { describe, expect, it, vi } from "vitest";
import type { AuthResponse, TwoFactorChallenge, User } from "@orbit/types";
import { googleErrorText, signInWithGoogle, type GoogleDeps, type GoogleStep } from "./googleSignIn";

const user = { id: "u1", email: "ada@gmail.com" } as User;

function run(deps: Partial<GoogleDeps>) {
  const steps: GoogleStep[] = [];
  const full: GoogleDeps = {
    open: deps.open ?? (() => Promise.resolve({ code: "the-code", verifier: "the-verifier" })),
    exchange: deps.exchange ?? (() => Promise.resolve({ user, access_token: "tok" })),
  };
  return { steps, done: signInWithGoogle(full, "https://api.test", (s) => steps.push(s)) };
}

describe("Continue with Google", () => {
  it("waits for the browser, trades the code with its verifier, and signs in", async () => {
    const open = vi.fn(() => Promise.resolve({ code: "c1", verifier: "v1" }));
    const exchange = vi.fn((): Promise<AuthResponse> => Promise.resolve({ user, access_token: "tok" }));
    const { steps, done } = run({ open, exchange });
    expect(await done).toEqual({ kind: "signed-in", auth: { user, access_token: "tok" } });
    expect(open).toHaveBeenCalledWith("https://api.test");
    expect(exchange).toHaveBeenCalledWith("c1", "v1");
    expect(steps.map((s) => s.kind)).toEqual(["waiting", "finishing", "idle"]);
  });

  it("hands over to the authenticator step when the account has one", async () => {
    const pending: TwoFactorChallenge = { two_factor_required: true, challenge: "ch" };
    const { steps, done } = run({ exchange: () => Promise.resolve(pending) });
    expect(await done).toEqual({ kind: "two-factor", challenge: "ch" });
    expect(steps.at(-1)).toEqual({ kind: "idle" });
  });

  it.each(["cancelled", "duplicate"])("goes quietly back to the button when %s", async (why) => {
    const exchange = vi.fn();
    const { steps, done } = run({ open: () => Promise.reject(why), exchange });
    expect(await done).toEqual({ kind: "cancelled" });
    expect(steps).toEqual([{ kind: "waiting" }, { kind: "idle" }]);
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", "Google sign-in timed out. Try again when you're ready."],
    ["denied", "Google sign-in was cancelled in the browser."],
    ["suspended", "This account is suspended."],
    ["google_off", "Google sign-in isn't available right now. Sign in with your email instead."],
    ["busy", "Too many sign-in attempts from your network. Wait a minute, then try again."],
    ["constructor", "Google sign-in didn't finish. Try again, or use your email."],
    ["something_new", "Google sign-in didn't finish. Try again, or use your email."],
  ])("says why the browser came back with %s", async (code, message) => {
    const { steps, done } = run({ open: () => Promise.reject(code) });
    expect(await done).toEqual({ kind: "failed", message });
    expect(steps.at(-1)).toEqual({ kind: "error", message });
  });

  it("shows the exchange's own answer when it refuses", async () => {
    const err = new Error("That sign-in expired or was already used. Press Continue with Google again.");
    const { done } = run({ exchange: () => Promise.reject(err) });
    expect(await done).toEqual({ kind: "failed", message: err.message });
  });

  it("never signs in without a token", async () => {
    const { done } = run({ exchange: () => Promise.resolve({ user, access_token: null }) });
    expect(await done).toEqual({ kind: "failed", message: "Sign-in didn't finish. Please try again." });
  });

  it("explains a browser that couldn't open, without the raw error", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(googleErrorText("failed: couldn't open the browser: os error 2")).toMatch(/couldn't open your browser/);
    expect(googleErrorText("failed: address in use")).toBe("Google sign-in couldn't start on this PC. Try again, or use your email.");
    expect(googleErrorText(42)).toBe("Google sign-in didn't finish. Try again, or use your email.");
  });
});
