import { describe, expect, it } from "vitest";
import { ApiError } from "@orbit/ui";
import {
  CONTACT_TOPICS,
  MESSAGE_MAX,
  buildContactRequest,
  contactErrorText,
  contactHref,
  fieldErrors,
  messageCounter,
  readPrefill,
  startingMessage,
  topicLabel,
  type ContactFields,
} from "./contactForm";

const READY: ContactFields = {
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "",
  topic: "payment",
  message: "I paid for the Mini pack but no credits yet.",
};

describe("the topics", () => {
  it("are the server's seven, in its order, each with a hint", () => {
    expect(CONTACT_TOPICS.map((t) => t.id)).toEqual(["general", "payment", "technical", "report_job", "business", "feedback", "other"]);
    expect(CONTACT_TOPICS.every((t) => t.label && t.hint)).toBe(true);
    expect(topicLabel("report_job")).toBe("Report a job");
    expect(topicLabel("mystery")).toBe("mystery");
  });
});

describe("readPrefill and contactHref (Report this job → the form)", () => {
  it("round-trips a job report", () => {
    const href = contactHref({ topic: "report_job", listing: "j3f2a9c", reason: "Asked me to pay a fee", from: "/jobs/listing/j3f2a9c" });
    expect(href).toBe("/contact?topic=report_job&listing=j3f2a9c&reason=Asked+me+to+pay+a+fee&from=%2Fjobs%2Flisting%2Fj3f2a9c");
    expect(readPrefill(href.slice(href.indexOf("?")))).toEqual({
      topic: "report_job",
      listing: "j3f2a9c",
      reason: "Asked me to pay a fee",
      from: "/jobs/listing/j3f2a9c",
    });
    expect(contactHref()).toBe("/contact");
  });

  it("assumes a report when only a listing is given, and ignores what it doesn't know", () => {
    expect(readPrefill("?listing=j1").topic).toBe("report_job");
    expect(readPrefill("?topic=sales")).toEqual({ topic: null, listing: null, reason: null, from: null });
    expect(readPrefill("?topic=feedback&listing=bad%20id!").listing).toBeNull();
    expect(readPrefill(`?reason=${"x".repeat(81)}`).reason).toBeNull();
  });

  it("only ever takes an app path as where it came from", () => {
    for (const from of ["//evil.example/x", "https://evil.example", "javascript:alert(1)", "/\\evil.example", `/${"a".repeat(200)}`]) {
      expect(readPrefill(`?from=${encodeURIComponent(from)}`).from).toBeNull();
    }
    expect(readPrefill("?from=%2Fbilling").from).toBe("/billing");
  });

  it("starts a report's message with the reason", () => {
    expect(startingMessage(readPrefill("?reason=Asked+for+an+OTP+or+bank+details"))).toBe("Asked for an OTP or bank details. ");
    expect(startingMessage(readPrefill("?reason=Job+is+closed!"))).toBe("Job is closed. ");
    expect(startingMessage(readPrefill(""))).toBe("");
  });
});

describe("fieldErrors (the server's bounds, checked before sending)", () => {
  it("passes a complete message", () => {
    expect(fieldErrors(READY)).toEqual({});
    expect(fieldErrors({ ...READY, phone: "+91 98765 43210" })).toEqual({});
  });

  it("names each problem on its own field", () => {
    const e = fieldErrors({ name: "  ", email: "asha@", phone: "call me", topic: "", message: "short" });
    expect(Object.keys(e).sort()).toEqual(["email", "message", "name", "phone", "topic"]);
    expect(fieldErrors({ ...READY, email: "" }).email).toMatch(/reply/);
    expect(fieldErrors({ ...READY, name: "x".repeat(121) }).name).toMatch(/120/);
    expect(fieldErrors({ ...READY, phone: "12345" }).phone).toBeTruthy();
    expect(fieldErrors({ ...READY, message: "x".repeat(MESSAGE_MAX + 1) }).message).toMatch(/3,000/);
    expect(fieldErrors({ ...READY, message: "  nine ch  " }).message).toMatch(/at least 10/);
  });
});

describe("messageCounter", () => {
  it("counts against the limit and warns near it", () => {
    expect(messageCounter("hello")).toEqual({ text: "5 / 3,000", over: false, near: false });
    expect(messageCounter("x".repeat(2800)).near).toBe(true);
    expect(messageCounter("x".repeat(3001))).toMatchObject({ text: "3,001 / 3,000", over: true });
  });
});

describe("buildContactRequest", () => {
  it("trims, and sends only what's set", () => {
    expect(buildContactRequest({ ...READY, name: "  Asha Rao ", message: `  ${READY.message}  ` }, null, null)).toEqual({
      name: "Asha Rao",
      email: "asha@example.com",
      topic: "payment",
      message: READY.message,
    });
  });

  it("carries the phone, the context, the bot check and the honeypot when present", () => {
    const req = buildContactRequest({ ...READY, phone: " 98765 43210 " }, { listing_id: "j1", listing_title: "", page: "/jobs" }, "tok", "spam.example");
    expect(req).toMatchObject({ phone: "98765 43210", context: { listing_id: "j1", page: "/jobs" }, captcha_token: "tok", website: "spam.example" });
    expect(req.context).not.toHaveProperty("listing_title");
  });
});

describe("contactErrorText", () => {
  it("is friendly about rate limits, using the server's words when it gives them", () => {
    expect(contactErrorText(new ApiError(429, "You've sent a lot of messages today. Please try again tomorrow."))).toMatch(/tomorrow/);
    expect(contactErrorText(new ApiError(429, "Too many requests — slow down for a moment."))).toMatch(/wait a while/);
  });

  it("explains the bot check, bad input and being offline", () => {
    expect(contactErrorText(new ApiError(400, "x", "captcha_failed"))).toMatch(/security check/);
    expect(contactErrorText(new ApiError(422, "That phone number doesn't look right."))).toMatch(/phone/);
    expect(contactErrorText(new ApiError(0, "Can't reach Orbit. Check your internet connection.", "offline"))).toMatch(/internet/);
    expect(contactErrorText(new Error("boom"))).toMatch(/try again in a minute/);
  });
});

describe("the topics outside India", () => {
  it("offer partnerships to universities and teams; India's stay as they are", async () => {
    const { CONTACT_TOPICS, contactTopics } = await import("./contactForm");
    expect(contactTopics("IN")).toBe(CONTACT_TOPICS);
    const hint = contactTopics("US").find((t) => t.id === "business")?.hint;
    expect(hint).toBe("Universities, career services, bootcamps and teams: tell us what you have in mind.");
    expect(contactTopics("US").map((t) => t.id)).toEqual(CONTACT_TOPICS.map((t) => t.id));
  });
});
