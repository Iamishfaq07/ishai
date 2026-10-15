import { describe, expect, it } from "vitest";
import {
  INBOX_FILTERS,
  badgeText,
  contextRows,
  filterCount,
  greeting,
  mailtoReply,
  quoted,
  readFilter,
  replySubject,
  safeHttpUrl,
  unreadLabel,
  whatsappNumber,
} from "./inbox";

const MESSAGE = {
  email: "asha.rao+orbit@example.com",
  name: "Asha Rao",
  topic_label: "Payment or credits",
  reference: "C-1A2B3C4D",
  message: "I paid ₹499 for Mini.\n\nUTR 123456789012",
  created_at: "2026-10-08T12:00:00Z",
};

describe("the list's tabs", () => {
  it("start on To answer and read only known filters from the address", () => {
    expect(INBOX_FILTERS.map((f) => f.id)).toEqual(["todo", "new", "done", "spam", "all"]);
    expect(readFilter(null)).toBe("todo");
    expect(readFilter("spam")).toBe("spam");
    expect(readFilter("archived")).toBe("todo");
  });

  it("count each tab from the server's counts", () => {
    const counts = { new: 2, open: 3, done: 7, spam: 1, todo: 5, all: 13 };
    expect(filterCount(counts, "todo")).toBe(5);
    expect(filterCount(counts, "new")).toBe(2);
    expect(filterCount(undefined, "all")).toBe(0);
  });

  it("caps the unread badge and names it for screen readers", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(140)).toBe("99+");
    expect(unreadLabel(1)).toBe("1 unread message");
    expect(unreadLabel(3)).toBe("3 unread messages");
  });
});

describe("replying", () => {
  it("greets by first name", () => {
    expect(greeting("  Asha  Rao ")).toBe("Hi Asha,\n\n");
    expect(greeting("")).toBe("Hi,\n\n");
  });

  it("quotes the message line by line, and cuts a long one short", () => {
    expect(quoted("one\n\ntwo")).toBe("> one\n>\n> two");
    expect(quoted("x".repeat(20), 10)).toBe(`> ${"x".repeat(10)}…`);
  });

  it("uses the in-app reply's subject", () => {
    expect(replySubject(MESSAGE)).toBe("Re: Payment or credits (C-1A2B3C4D)");
  });

  it("builds a mailto: with the subject, the greeting or what's typed, and the quote", () => {
    const url = mailtoReply(MESSAGE);
    expect(url.startsWith("mailto:asha.rao%2Borbit@example.com?subject=Re%3A%20Payment%20or%20credits%20(C-1A2B3C4D)&body=")).toBe(true);
    const body = decodeURIComponent(url.split("&body=")[1]!);
    expect(body.startsWith("Hi Asha,\r\n\r\n\r\nOn 8 Oct 2026 you wrote (C-1A2B3C4D):\r\n> I paid ₹499 for Mini.\r\n>\r\n> UTR 123456789012")).toBe(true);
    expect(body).not.toMatch(/[^\r]\n/); // CRLF only
    const typed = decodeURIComponent(mailtoReply(MESSAGE, "Hi Asha,\n\nDone, they're on your account.  ").split("&body=")[1]!);
    expect(typed.startsWith("Hi Asha,\r\n\r\nDone, they're on your account.\r\n\r\n\r\nOn 8 Oct 2026")).toBe(true);
  });

  it("can't be turned into extra headers by the address", () => {
    const url = mailtoReply({ ...MESSAGE, email: "a@example.com?bcc=evil@example.com&x=" });
    expect(url.split("?")[0]).toBe("mailto:a@example.com%3Fbcc%3Devil@example.com%26x%3D");
    expect(url.match(/[?&]bcc=/i)).toBeNull();
  });

  it("finds a WhatsApp number in what was typed", () => {
    expect(whatsappNumber("98765 43210")).toBe("919876543210");
    expect(whatsappNumber("+91 98765-43210")).toBe("919876543210");
    expect(whatsappNumber("+44 20 7946 0958")).toBe("442079460958");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
});

describe("the context", () => {
  it("shows a reported job with its post (http only) and its page in Jobs AI", () => {
    expect(
      contextRows({
        listing_id: "j3f2a9c",
        listing_title: "Staff Engineer",
        listing_company: "Acme",
        listing_url: "https://boards.example/acme/1",
        reason: "Asked me to pay a fee",
        page: "/jobs/listing/j3f2a9c",
      }),
    ).toEqual([
      { label: "Job", value: "Staff Engineer at Acme", href: "https://boards.example/acme/1" },
      { label: "In Jobs AI", value: "j3f2a9c", to: "/jobs/listing/j3f2a9c" },
      { label: "What's wrong", value: "Asked me to pay a fee" },
      { label: "Sent from", value: "/jobs/listing/j3f2a9c" },
    ]);
  });

  it("shows which app sent it and the sender's latest session", () => {
    expect(contextRows({ platform: "desktop-0.1.25", latest_session_id: "s-1" })).toEqual([
      { label: "App", value: "Desktop v0.1.25" },
      { label: "Latest session", value: "s-1" },
    ]);
    expect(contextRows({ platform: "web" })).toEqual([{ label: "App", value: "Website" }]);
  });

  it("never links anything but http(s), and is empty without context", () => {
    expect(contextRows({ listing_title: "Job", listing_url: "javascript:alert(1)" })).toEqual([{ label: "Job", value: "Job" }]);
    expect(contextRows({ listing_id: "ext:abc" }).map((r) => r.label)).toEqual(["Job"]);
    expect(contextRows(null)).toEqual([]);
    expect(safeHttpUrl("HTTPS://x.example")).toBe("HTTPS://x.example");
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("https:///nohost")).toBeNull();
  });
});
