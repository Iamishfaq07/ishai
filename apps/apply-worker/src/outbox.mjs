import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, rename, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Durable receipts are encrypted at rest; retrying a receipt never repeats the browser submission. */
export class Outbox {
  constructor(directory, secret) {
    this.directory = directory;
    this.key = createHash("sha256").update(`orbit-apply-receipts:${secret}`).digest();
  }
  async put(lease, result) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ id: lease.packet.id, token: lease.token, result })), cipher.final()]);
    const target = join(this.directory, `${lease.packet.id}.receipt`);
    const temp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
    await rename(temp, target);
  }
  async flush(api) {
    let names;
    try { names = await readdir(this.directory); } catch (e) { if (e.code === "ENOENT") return; throw e; }
    for (const name of names.filter((n) => /^[0-9a-f-]{36}\.receipt$/.test(n)).slice(0, 100)) {
      const path = join(this.directory, name), raw = await readFile(path);
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const item = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
      let response = await api(`/${item.id}/result`, { token: item.token, result: item.result });
      if ([413, 422].includes(response.status)) {
        // A large picture or audit payload must not block the queue forever. Preserve the employer confirmation;
        // a rejected minimum receipt becomes Needs you for reconciliation rather than another browser attempt.
        response = await api(`/${item.id}/result`, { token: item.token,
          result: { ...item.result, screenshot_png_b64: null, submitted: null, unknown_questions: [] } });
        if (response.status === 422) response = await api(`/${item.id}/result`, {
          token: item.token, result: { status: "needs_you", reason: "error" } });
      }
      // Final conflicts mean the old receipt window ended or this attempt was superseded. No browser retry here.
      if (response.ok || [404, 409].includes(response.status)) await unlink(path);
      else throw new Error(`Receipt delivery failed (${response.status}).`);
    }
  }
}
