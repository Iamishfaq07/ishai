import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateInfo } from "./native";

const native = vi.hoisted(() => ({
  checkUpdate: vi.fn<(apiUrl: string) => Promise<UpdateInfo | null>>(),
  downloadUpdate: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
}));
vi.mock("./native", () => native);
vi.mock("./api", () => ({ API_URL: "https://api.test" }));
vi.mock("@orbit/ui", () => ({ confirmDialog: vi.fn() }));

const release = (version: string): UpdateInfo => ({ version, currentVersion: "0.1.33", notes: null, date: null });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// updates.ts keeps its state in the module: a fresh copy per test.
async function load() {
  vi.resetModules();
  return import("./updates");
}

let now = 0;
beforeEach(() => {
  vi.clearAllMocks();
  now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

describe("update checks", () => {
  it("offers an update the server has", async () => {
    const u = await load();
    native.checkUpdate.mockResolvedValue(release("0.1.34"));
    u.checkForUpdate();
    await settle();
    expect(native.checkUpdate).toHaveBeenCalledWith("https://api.test");
    expect(phaseAndVersion(u)).toEqual(["available", "0.1.34"]);
  });

  it("checks again only once the last check is old enough", async () => {
    const u = await load();
    native.checkUpdate.mockResolvedValue(null);
    u.checkForUpdate();
    await settle();
    now += u.FOCUS_RECHECK_MS - 1;
    u.checkForUpdate(u.FOCUS_RECHECK_MS); // focus, too soon
    await settle();
    expect(native.checkUpdate).toHaveBeenCalledTimes(1);
    now += 1;
    u.checkForUpdate(u.FOCUS_RECHECK_MS); // focus after the gap
    u.checkForUpdate(); // the hourly timer at the same moment: one check is enough
    await settle();
    expect(native.checkUpdate).toHaveBeenCalledTimes(2);
  });

  it("a release published while Orbit runs replaces the one on offer", async () => {
    const u = await load();
    native.checkUpdate.mockResolvedValueOnce(release("0.1.34")).mockResolvedValueOnce(release("0.1.35"));
    u.checkForUpdate();
    await settle();
    now += u.RECHECK_MS;
    u.checkForUpdate();
    await settle();
    expect(phaseAndVersion(u)).toEqual(["available", "0.1.35"]);
  });

  it("a withdrawn release is no longer offered", async () => {
    const u = await load();
    native.checkUpdate.mockResolvedValueOnce(release("0.1.34")).mockResolvedValueOnce(null);
    u.checkForUpdate();
    await settle();
    u.checkForUpdate();
    await settle();
    expect(phaseAndVersion(u)).toEqual(["idle", null]);
  });

  it("doesn't check while an update is downloading", async () => {
    const u = await load();
    native.checkUpdate.mockResolvedValue(release("0.1.34"));
    native.downloadUpdate.mockReturnValue(new Promise(() => undefined)); // still downloading
    u.checkForUpdate();
    await settle();
    u.startUpdate();
    u.checkForUpdate();
    await settle();
    expect(native.checkUpdate).toHaveBeenCalledTimes(1);
    expect(phaseAndVersion(u)).toEqual(["downloading", "0.1.34"]);
  });

  it("a failed check is retried at the next chance", async () => {
    const u = await load();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    native.checkUpdate.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(release("0.1.34"));
    u.checkForUpdate();
    await settle();
    u.checkForUpdate(u.FOCUS_RECHECK_MS); // no successful check yet: not too soon
    await settle();
    expect(phaseAndVersion(u)).toEqual(["available", "0.1.34"]);
  });
});

function phaseAndVersion(u: typeof import("./updates")): [string, string | null] {
  const s = u.getUpdateState();
  return [s.phase, s.info?.version ?? null];
}
