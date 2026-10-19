import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { createEgressProxy } from "./egress.mjs";
import { Outbox } from "./outbox.mjs";
import { runLease } from "./worker.mjs";
import { browserEnvironment } from "./sites.mjs";

const base = (process.env.ORBIT_API_URL || "").replace(/\/+$/, "");
const secret = process.env.ORBIT_APPLY_WORKER_SECRET || "";
const worker_id = randomUUID();
if (!base || secret.length < 32 || new URL(base).protocol !== "https:" && process.env.ORBIT_ENV !== "development") {
  throw new Error("Set an HTTPS ORBIT_API_URL and an ORBIT_APPLY_WORKER_SECRET of at least 32 characters.");
}
const api = (path, body, headers = {}) => fetch(`${base}/v1/internal/apply${path}`, {
  method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
  headers: { "Content-Type": "application/json", "X-Orbit-Worker-Secret": secret, ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const outbox = new Outbox(process.env.ORBIT_APPLY_OUTBOX || "/data/receipts", secret);
const proxy = await createEgressProxy();
const browser = await chromium.launch({ headless: true, chromiumSandbox: true, env: browserEnvironment(process.env),
  proxy: { server: proxy.url, bypass: "<-loopback>" },
  args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
let stopping = false, heartbeatBusy = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; void browser.close().catch(() => {}); });
const pulse = setInterval(async () => {
  if (heartbeatBusy) return;
  heartbeatBusy = true;
  try { await api("/heartbeat", { worker_id }); } catch { /* The active attempt's monitor stops it on API loss. */ }
  finally { heartbeatBusy = false; }
}, 20_000);
try {
  while (!stopping) {
    try {
      await outbox.flush(api);
      const response = await api("/next", { worker_id });
      if (response.status === 204) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
      if (!response.ok) throw new Error(`Worker queue returned ${response.status}.`);
      const lease = await response.json();
      const resumeResponse = await api(`/${lease.packet.id}/resume.pdf`, undefined, { "X-Orbit-Attempt": lease.token });
      if (!resumeResponse.ok) throw new Error(`Resume returned ${resumeResponse.status}.`);
      const bytes = Buffer.from(await resumeResponse.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid resume.");
      const result = await runLease(browser, lease, api, { b64: bytes.toString("base64"), type: "application/pdf", filename: lease.packet.resume.filename });
      await outbox.put(lease, result);
      await outbox.flush(api);
      console.log(JSON.stringify({ event: "apply_result", status: result.status, reason: result.reason }));
    } catch {
      // Do not log URLs, candidate data, attempt tokens or the worker credential.
      console.error(JSON.stringify({ event: "apply_worker_retry" }));
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
} finally {
  clearInterval(pulse);
  await browser.close();
  await proxy.close();
}
