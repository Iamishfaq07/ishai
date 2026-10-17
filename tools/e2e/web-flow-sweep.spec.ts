import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Regressions from the web flow sweep: things a click used to get wrong (an upload refused as "can't reach Orbit",
// a purchase whose result was off-screen, a live session that couldn't start with many documents, a support chat
// that never showed a reply, dead ends on deleted items).
const API = "http://127.0.0.1:8000";

async function signup(context: BrowserContext, country = "IN") {
  const r = await context.request.post(`${API}/v1/auth/register`, {
    data: { email: `sweep-${crypto.randomUUID()}@example.com`, password: "correct horse battery", name: "Meera Shah", country },
  });
  expect(r.status(), await r.text()).toBe(201);
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
}

const doc = (id: string, kind: "resume" | "job_description", title = id) => ({
  id, title, kind, filename: null, size_bytes: 100, status: "ready", chunk_count: 1, created_at: "2026-10-01T00:00:00Z",
});

test("documents: the upload limit is the server's 5 MB, checked before sending", async ({ page, context }) => {
  await signup(context);
  await page.goto("/documents");
  await expect(page.getByText("PDF, DOCX, TXT or MD, up to 5 MB")).toBeVisible();
  let sent = false;
  await page.route(`${API}/v1/documents`, (route) => {
    sent = true;
    return route.continue();
  });
  await page.locator("input[type=file]").first().setInputFiles({ name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(6 * 1024 * 1024, 97) });
  await expect(page.getByText("That file is over 5 MB.")).toBeVisible();
  expect(sent).toBe(false);
});

async function stubRazorpay(page: Page) {
  await page.route(`${API}/v1/billing/packs`, async (route) => {
    const res = await route.fetch();
    const packs = (await res.json()) as Record<string, unknown>[];
    await route.fulfill({ response: res, json: packs.map((p) => ({ ...p, checkout: "razorpay", buyable: true })) });
  });
  await page.route(`${API}/v1/billing/razorpay/orders`, (route) => route.fulfill({
    json: { key_id: "rzp_test_x", order_id: "order_test", amount_paise: 359900, currency: "INR", label: "3 interview credits", email: "a@example.com" },
  }));
  await page.route(`${API}/v1/billing/razorpay/verify`, (route) => route.fulfill({
    json: { id: "o1", status: "approved", label: "3 interview credits", method: "razorpay", amount_inr: 3599, reference: "ORBTEST", created_at: new Date().toISOString(), pack: "starter" },
  }));
  // Razorpay's checkout script, stubbed: it "pays" at once. Nothing reaches Razorpay.
  await page.route("https://checkout.razorpay.com/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.Razorpay = class { constructor(o) { this.o = o; } on() {} open() { setTimeout(() => this.o.handler({
      razorpay_order_id: "order_test", razorpay_payment_id: "pay_test", razorpay_signature: "sig" }), 50); } };`,
  }));
}

test("billing on a phone: a purchase's result is brought into view", async ({ page, context }) => {
  await signup(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await stubRazorpay(page);
  await page.goto("/billing");
  await page.getByRole("button", { name: /^Buy · / }).nth(1).click();
  const done = page.getByText("3 interview credits added. Thanks!");
  await expect(done).toBeVisible();
  await expect(done).toBeInViewport();
});

test("billing abroad with dollar checkout off: no UPI wording", async ({ page, context }) => {
  await signup(context, "US");
  await page.route(`${API}/v1/billing/packs`, async (route) => {
    const res = await route.fetch();
    const packs = (await res.json()) as Record<string, unknown>[];
    await route.fulfill({ response: res, json: packs.map((p) => ({ ...p, currency: "USD", price_text: "$9.99", checkout: "upi", buyable: false })) });
  });
  await page.goto("/billing");
  await expect(page.getByText("Paying in dollars isn't open yet.", { exact: false })).toBeVisible();
  await expect(page.getByText("Pay once over UPI", { exact: false })).toHaveCount(0);
});

test("live setup with many saved job posts: at most 20 documents, the resume kept", async ({ page, context }) => {
  await signup(context);
  // Newest first, as the API lists them: 22 job posts saved by Jobs AI, then the resume.
  const docs = [...Array.from({ length: 22 }, (_, i) => doc(`jd-${i}`, "job_description", `Job post ${i}`)), doc("cv", "resume", "My resume")];
  await page.route(`${API}/v1/documents`, (route) => (route.request().method() === "GET" ? route.fulfill({ json: docs }) : route.continue()));
  let body: { document_ids?: string[] } | null = null;
  await page.route(`${API}/v1/sessions`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    body = route.request().postDataJSON() as { document_ids?: string[] };
    await route.fulfill({ status: 422, json: { detail: "stopped by the test" } });
  });
  await page.goto("/start");
  await expect(page.getByLabel("My resume")).toBeChecked();
  await expect(page.getByText("A session can use up to 20 documents.", { exact: false })).toBeVisible();
  expect(await page.locator("main input[type=checkbox]:checked").count()).toBe(20);
  await expect(page.getByLabel("Job post 21")).toBeDisabled();
  // Headless Chrome has no microphone, so the ready check may hold Start back: start anyway (the API is stubbed).
  await expect(page.getByText(/^(Ready ·|\d+ problems? to fix)/)).toBeVisible();
  const anyway = page.getByRole("button", { name: "Start without these checks" });
  if (await anyway.isVisible()) {
    await anyway.click();
    await page.getByRole("button", { name: "Start anyway" }).click();
  } else {
    await page.getByRole("button", { name: "Start Session" }).click();
  }
  await expect.poll(() => body?.document_ids?.length ?? 0).toBe(20);
  expect(body!.document_ids).toContain("cv");
});

test("support chat: reopening it reads the thread from the API on another origin", async ({ page, context }) => {
  await signup(context);
  const refused: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes("/v1/support/")) refused.push(r.url()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Chat with support" }).click();
  await expect(page.getByText("Hi, I'm Orbit's support bot.", { exact: false })).toBeVisible();
  await page.getByPlaceholder("Or type a question…").fill("What is my balance?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("What is my balance?")).toBeVisible();
  // A new page load opens the saved chat with its token in a header: the preflight used to refuse it.
  await page.reload();
  await page.getByRole("button", { name: "Chat with support" }).click();
  await expect(page.getByText("What is my balance?")).toBeVisible();
  expect(refused).toEqual([]);
});

test("a deleted resume, session or problem says so, with a way back", async ({ page, context }) => {
  await signup(context);
  await page.goto(`/resume-ai/${crypto.randomUUID()}`);
  await expect(page.getByText("That resume isn't here")).toBeVisible();
  await expect(page.getByRole("link", { name: "See your resumes" })).toBeVisible();
  await page.goto(`/sessions/${crypto.randomUUID()}`);
  await expect(page.getByText("That session isn't here")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await page.goto("/code/no-such-problem");
  await expect(page.getByText("That problem isn't here")).toBeVisible();
});

test("offer form: the joining bonus is paid once, and equity says its unit", async ({ page, context }) => {
  await signup(context);
  await page.goto("/offers");
  await page.getByRole("button", { name: "Add your first offer" }).click();
  await page.getByLabel("Currency").selectOption("INR");
  const form = page.locator("form").first();
  await expect(form.getByText("In lakh", { exact: true })).toBeVisible(); // the joining bonus's hint
  await expect(form.getByText("The grant's value divided by its vesting years, as the offer states it. In lakh a year")).toBeVisible();
  await page.getByLabel("Equity a year").fill("3");
  await expect(form.getByText("₹3,00,000", { exact: false })).toBeVisible();
});
