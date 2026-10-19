import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { publicAddress, publicEndpoint, createEgressProxy } from "./egress.mjs";
import { applicationUrl, sameEmployer, sameApplication, browserEnvironment } from "./sites.mjs";
import { Outbox } from "./outbox.mjs";

test("browser egress rejects private, metadata, reserved and mapped addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "172.16.0.1", "0.0.0.0", "224.1.1.1", "203.0.113.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "bad"]) {
    assert.equal(publicAddress(address), false, address);
  }
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});

test("browser child processes never inherit Orbit or provider credentials", () => {
  assert.deepEqual(browserEnvironment({ PATH: "/usr/bin", LANG: "en_US.UTF-8", ORBIT_APPLY_WORKER_SECRET: "private",
    ORBIT_DATABASE_URL: "private", OPENAI_API_KEY: "private", AWS_SESSION_TOKEN: "private" }),
  { PATH: "/usr/bin", LANG: "en_US.UTF-8" });
});

test("mixed DNS responses are refused and the returned endpoint is the checked IP", async () => {
  await assert.rejects(publicEndpoint("example.test", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]));
  const record = await publicEndpoint("example.test", async () => [{ address: "8.8.8.8", family: 4 }]);
  assert.deepEqual(record, { address: "8.8.8.8", family: 4 });
});

test("the actual browser proxy refuses a private CONNECT target", async () => {
  const proxy = await createEgressProxy();
  try {
    const refused = await new Promise((resolve, reject) => {
      const request = http.request(proxy.url, { method: "CONNECT", path: "127.0.0.1:443" });
      request.once("connect", (_response, socket) => { socket.destroy(); reject(new Error("Private tunnel opened")); });
      request.once("error", () => resolve(true));
      request.setTimeout(2000, () => { request.destroy(); reject(new Error("Proxy did not refuse promptly")); });
      request.end();
    });
    assert.equal(refused, true);
  } finally { await proxy.close(); }
});

test("only actual employer application hosts and paths are accepted", () => {
  assert.ok(applicationUrl("https://example.wd5.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply", "workday"));
  assert.ok(applicationUrl("https://apply.workable.com/example/j/ABC123/apply/", "workable"));
  for (const url of ["https://evilgreenhouse.io/acme/jobs/1", "https://job-boards.greenhouse.io.evil.test/acme/jobs/1", "https://user:password@job-boards.greenhouse.io/acme/jobs/1", "https://job-boards.greenhouse.io:8443/acme/jobs/1", "http://job-boards.greenhouse.io/acme/jobs/1", "https://127.0.0.1/acme/jobs/1"]) {
    assert.equal(applicationUrl(url, "greenhouse"), null, url);
  }
  assert.equal(sameEmployer("https://accounts.example.com/sign-in", "https://jobs.example.com"), false);
  const original = applicationUrl("https://apply.workable.com/j/ABC123/apply/", "workable");
  assert.equal(sameApplication("https://apply.workable.com/example/j/ABC123/apply/", original, "workable"), true);
  assert.equal(sameApplication("https://apply.workable.com/example/j/OTHER1/apply/", original, "workable"), false);
});

test("encrypted receipt outbox retries delivery without repeating browser actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-receipts-"));
  try {
    const outbox = new Outbox(directory, "test-only-worker-secret-at-least-32-characters");
    const lease = { token: "a-private-attempt-token", packet: { id: randomUUID() } };
    const result = { status: "submitted", confirmation_text: "sensitive candidate confirmation", submitted: { fields: { email: "candidate@example.test" } } };
    await outbox.put(lease, result);
    const file = join(directory, (await readdir(directory))[0]);
    const raw = await readFile(file);
    assert.equal(raw.includes(Buffer.from("candidate@example.test")), false);
    assert.equal(raw.includes(Buffer.from(lease.token)), false);
    await assert.rejects(outbox.flush(async () => { throw new Error("Network unavailable"); }));
    assert.equal((await readdir(directory)).length, 1);
    let delivered;
    await outbox.flush(async (_path, body) => { delivered = body; return { ok: true, status: 200 }; });
    assert.deepEqual(delivered, { token: lease.token, result });
    assert.equal((await readdir(directory)).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an oversized receipt is reduced without losing its employer confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbit-receipt-limit-"));
  try {
    const outbox = new Outbox(directory, "test-only-worker-secret-at-least-32-characters");
    await outbox.put({ token: "private-attempt", packet: { id: randomUUID() } }, {
      status: "submitted", confirmation_text: "Your application was submitted", screenshot_png_b64: "large-picture",
      submitted: { fields: { email: "candidate@example.test" } },
    });
    const bodies = [];
    await outbox.flush(async (_path, body) => {
      bodies.push(body); return bodies.length === 1 ? { ok: false, status: 413 } : { ok: true, status: 200 };
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].result.status, "submitted");
    assert.equal(bodies[1].result.confirmation_text, "Your application was submitted");
    assert.equal(bodies[1].result.screenshot_png_b64, null);
    assert.equal((await readdir(directory)).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
