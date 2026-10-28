import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountNotices } from "@orbit/types";

const server = vi.hoisted(() => ({ notices: vi.fn(), readNotices: vi.fn() }));
vi.mock("./api", () => ({ api: server }));

import { readNotices, refreshNotices, resetNotices, subscribeNotices } from "./notices";

const item = (id: string, read = false) => ({ id, kind: "credits" as const, title: `You've got ${id}`, body: "",
  link: "/billing", created_at: "2026-10-28T10:00:00Z", read });

describe("account notices", () => {
  let seen: (AccountNotices | null)[] = [];
  let stop = () => undefined as void;
  beforeEach(() => {
    stop();
    resetNotices();
    server.notices.mockReset();
    server.readNotices.mockReset();
    seen = [];
    stop = subscribeNotices((n) => void seen.push(n));
  });

  it("marks one read on screen at once, then shows the server's answer", async () => {
    server.notices.mockResolvedValue({ items: [item("a"), item("b")], unread: 2 });
    await refreshNotices();
    let answer: (v: AccountNotices) => void = () => undefined;
    server.readNotices.mockReturnValue(new Promise<AccountNotices>((r) => { answer = r; }));
    const done = readNotices(["a"]);
    expect(seen.at(-1)).toEqual({ items: [item("a", true), item("b")], unread: 1 });
    answer({ items: [item("a", true), item("b", true)], unread: 0 });
    await done;
    expect(server.readNotices).toHaveBeenCalledWith(["a"]);
    expect(seen.at(-1)?.unread).toBe(0);
  });

  it("marks them all read with no ids", async () => {
    server.notices.mockResolvedValue({ items: [item("a"), item("b", true)], unread: 1 });
    await refreshNotices();
    server.readNotices.mockResolvedValue({ items: [item("a", true), item("b", true)], unread: 0 });
    await readNotices();
    expect(server.readNotices).toHaveBeenCalledWith(undefined);
    expect(seen.at(-1)?.unread).toBe(0);
  });

  it("stays quiet when the API fails, and asks nothing when nothing is unread", async () => {
    server.notices.mockRejectedValue(new Error("down"));
    await expect(refreshNotices()).resolves.toBeUndefined();
    expect(seen).toEqual([]);
    await readNotices();
    expect(server.readNotices).not.toHaveBeenCalled();
  });
});
