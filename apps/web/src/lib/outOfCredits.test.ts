import { afterEach, describe, expect, it } from "vitest";
import { onOutOfCredits, outOfCreditsFrom, watchForOutOfCredits, type OutOfCredits } from "./outOfCredits";

const RESUME_402 = {
  detail: {
    code: "upgrade_required",
    message: "You're out of resume AI credits.",
    pack: "starter",
    label: "Starter",
    price_inr: 1999,
    resume_credits: 30,
    interview_minutes: 60,
    buyable: true,
  },
};

describe("outOfCreditsFrom", () => {
  it("reads a resume AI 402 with the pack it offers", () => {
    expect(outOfCreditsFrom("/api/v1/resumes/suggest", "POST", RESUME_402)).toEqual({
      kind: "resume",
      offer: { pack: "starter", label: "Starter", price_inr: 1999, resume_credits: 30, interview_minutes: 60 },
    });
  });

  it("keeps the price in the buyer's currency when the server sends it", () => {
    const abroad = { detail: { ...RESUME_402.detail, price_text: "$29.99" } };
    expect(outOfCreditsFrom("/api/v1/resumes/suggest", "POST", abroad)?.offer?.price_text).toBe("$29.99");
  });

  it("says minutes when starting a session is refused", () => {
    const body = { detail: "You're out of interview minutes. Buy a pack to keep going." };
    expect(outOfCreditsFrom("/api/v1/sessions", "POST", body)).toEqual({ kind: "minutes" });
  });

  it("leaves other 402s alone: the document limit, and a live ticket its panel explains", () => {
    expect(outOfCreditsFrom("/api/v1/documents", "POST", { detail: "You can keep up to 3 documents." })).toBeNull();
    expect(outOfCreditsFrom("/api/v1/sessions/abc/ticket", "POST", { detail: "out" })).toBeNull();
    expect(outOfCreditsFrom("/api/v1/sessions", "GET", null)).toBeNull();
  });
});

describe("watchForOutOfCredits", () => {
  const seen: OutOfCredits[] = [];
  const stop = onOutOfCredits((e) => seen.push(e));
  afterEach(() => void seen.splice(0));

  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("announces a 402 and hands the reply back unread", async () => {
    const res = await watchForOutOfCredits(reply(402, RESUME_402))("http://x/api/v1/resumes/fix", { method: "POST" });
    expect(res.status).toBe(402);
    expect((await res.json()).detail.code).toBe("upgrade_required"); // the caller can still read it
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.map((e) => e.kind)).toEqual(["resume"]);
  });

  it("stays quiet on anything else", async () => {
    await watchForOutOfCredits(reply(422, { detail: [{ msg: "bad" }] }))("http://x/api/v1/resumes/fix", { method: "POST" });
    await watchForOutOfCredits(reply(200, { ok: true }))("http://x/api/v1/sessions", { method: "POST" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);
    stop();
  });
});
