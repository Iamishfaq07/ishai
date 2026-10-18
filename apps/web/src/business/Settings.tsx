// Orbit for Business (D82): the company's settings (profile, logo, data controls, blind review, email templates, the
// careers page and its widget), its plan, and its audit log.
import { useEffect, useId, useState, type FormEvent } from "react";
import type { BizAuditEntry, BizCompanySize, BizPlan, BizPlanStatus, BizTemplate } from "@orbit/types";
import { Button, Callout, CopyButton, ExternalLink, Field, Input, Select, Table, THead, Td, Textarea, Th, Toggle, Tr, Upload, toast } from "@orbit/ui";
import { biz } from "./api";
import { CountryPick, PageTitle, useCompany } from "./BusinessApp";
import { TEMPLATE_VARIABLES, embedSnippet, fillTemplate, iframeSnippet, relTime } from "./model";
import { Loading, LoadError, PLAN_LABEL, Panel, errorText } from "./ui";

const SIZES: BizCompanySize[] = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const TEMPLATE_TITLE: Record<BizTemplate["kind"], string> = {
  received: "Application received",
  stage: "Stage changed",
  rejection: "Not moving forward",
  interview: "Invite to interview",
};

function Profile() {
  const { company, setCompany } = useCompany();
  const id = useId();
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website);
  const [size, setSize] = useState(company.size);
  const [country, setCountry] = useState(company.country);
  const [about, setAbout] = useState(company.about);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const domainChanges = website.trim() !== company.website;
    setBusy(true);
    try {
      setCompany(await biz.updateCompany(company.id, { name: name.trim(), website: website.trim(), size, country, about: about.trim() }));
      toast({ message: domainChanges && company.verified ? "Saved. The new domain needs verifying again." : "Saved", tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 1024 * 1024) return toast({ message: "Use a PNG or JPEG up to 1 MB.", tone: "error" });
    setLogoBusy(true);
    try {
      setCompany(await biz.uploadLogo(company.id, file));
      toast({ message: "Logo updated", tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setLogoBusy(false);
    }
  };
  return (
    <Panel title="Company profile" hint="Shown on your careers page and job pages.">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {company.logo_url ? (
            <img src={company.logo_url} alt={`${company.name} logo`} width={64} height={64} className="h-16 w-16 rounded-xl border border-zinc-200 object-contain dark:border-white/10" />
          ) : (
            <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-100 text-2xl font-semibold dark:bg-white/5">
              {company.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 dark:border-white/10">
            <Upload className="h-4 w-4" aria-hidden /> {logoBusy ? "Uploading…" : "Upload logo"}
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          {company.logo_url && (
            <Button type="button" size="sm" variant="ghost" onClick={async () => setCompany(await biz.deleteLogo(company.id))}>
              Remove logo
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-n`}>
            <Input id={`${id}-n`} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Website" htmlFor={`${id}-w`} hint="Changing the domain means verifying again.">
            <Input id={`${id}-w`} value={website} maxLength={300} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          <Field label="Size" htmlFor={`${id}-s`}>
            <Select id={`${id}-s`} value={size} onChange={(e) => setSize(e.target.value as BizCompanySize)}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} people
                </option>
              ))}
            </Select>
          </Field>
          <CountryPick value={country} onChange={setCountry} />
        </div>
        <Field label="About" htmlFor={`${id}-a`} counter={{ value: about.length, max: 2000 }}>
          <Textarea id={`${id}-a`} rows={4} maxLength={2000} value={about} onChange={(e) => setAbout(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy}>
          Save profile
        </Button>
      </form>
    </Panel>
  );
}

function DataControls() {
  const { company, setCompany } = useCompany();
  const id = useId();
  const [months, setMonths] = useState(company.retention_months);
  const save = async (patch: { retention_months?: number; blind_review?: boolean }) => {
    try {
      setCompany(await biz.updateCompany(company.id, patch));
      toast({ message: "Saved", tone: "success" });
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };
  return (
    <Panel title="Fair review and data" hint="How applicants' data is kept, and what reviewers see.">
      <div className="space-y-5">
        <Toggle label="Blind review" description="Hide applicants' names, photos and contact details in the pipeline, so first reviews are about the work. Owners, admins and recruiters can show them when needed (it's logged)." checked={company.blind_review} onChange={(v) => void save({ blind_review: v })} />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ retention_months: months });
          }}
        >
          <div className="w-56">
            <Field label="Delete rejected applicants after" htmlFor={`${id}-m`} hint="Months after they're rejected, or after the job closes for anyone never decided on (1-48). Default 12. A change applies to applications made from now on: earlier applicants keep the period they were told.">
              <Input id={`${id}-m`} type="number" min={1} max={48} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(48, Number(e.target.value) || 12)))} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" className="mb-5">
            Save
          </Button>
        </form>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Applicants can ask you to delete their data from their status page; you'll see it on their profile, and Orbit deletes it 30 days after the request if you haven't (you're reminded a week and a day before). Export a job's applicants from its pipeline.</p>
      </div>
    </Panel>
  );
}

function Templates() {
  const { company } = useCompany();
  const [items, setItems] = useState<BizTemplate[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    biz.templates(company.id).then(setItems).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id]);
  if (error) return <LoadError error={error} />;
  if (!items) return <Loading />;
  return (
    <Panel title="Email templates" hint={`Sent from Orbit's address, with replies going to the teammate who sent them. Variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}.`}>
      <div className="space-y-4">
        {items.map((t) => (
          <TemplateEditor key={t.kind} t={t} onSaved={(n) => setItems(items.map((x) => (x.kind === n.kind ? n : x)))} />
        ))}
      </div>
    </Panel>
  );
}

function TemplateEditor({ t, onSaved }: { t: BizTemplate; onSaved: (t: BizTemplate) => void }) {
  const { company } = useCompany();
  const id = useId();
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const sample = { candidate_name: "Asha", job_title: "Backend Engineer", company_name: company.name, stage: "Interview", status_link: "https://orbitanswer.com/application/…", recruiter_name: "Your name" };
  return (
    <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <summary className="cursor-pointer text-sm font-medium">
        {TEMPLATE_TITLE[t.kind]} {t.is_default && <span className="text-xs font-normal text-zinc-500">(Orbit's default)</span>}
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onSaved(await biz.saveTemplate(company.id, t.kind, subject.trim(), body.trim()));
            toast({ message: "Template saved", tone: "success" });
          } catch (err) {
            toast({ message: errorText(err), tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Subject" htmlFor={`${id}-s`}>
          <Input id={`${id}-s`} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" htmlFor={`${id}-b`}>
          <Textarea id={`${id}-b`} rows={7} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-expanded={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? "Hide preview" : "Preview"}
          </Button>
        </div>
        {preview && (
          <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-white/5">
            <p className="font-medium">{fillTemplate(subject, sample)}</p>
            <p className="mt-2 whitespace-pre-line">{fillTemplate(body, sample)}</p>
          </div>
        )}
      </form>
    </details>
  );
}

function CareersSite() {
  const { company } = useCompany();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://orbitanswer.com";
  const snippet = embedSnippet(origin, company.slug);
  const iframe = iframeSnippet(origin, company.slug);
  return (
    <Panel title="Careers page and widget" hint="Your open jobs, on Orbit and on your own site.">
      <div className="space-y-4 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <a href={company.careers_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium underline">
            {company.careers_url.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <CopyButton text={company.careers_url} label="Copy link" />
        </p>
        <div>
          <p className="font-medium">Put your open jobs on your website</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Paste this where the list should appear. It updates itself when jobs open or close.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-50 p-3 text-xs dark:bg-white/5">{snippet}</pre>
          <CopyButton className="mt-2" text={snippet} label="Copy snippet" />
        </div>
        <details>
          <summary className="cursor-pointer text-xs">Or an iframe, if your site doesn't allow scripts</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-50 p-3 text-xs dark:bg-white/5">{iframe}</pre>
          <CopyButton className="mt-2" text={iframe} label="Copy iframe" />
        </details>
      </div>
    </Panel>
  );
}

export function CompanySettings() {
  const { company } = useCompany();
  if (!company.permissions.manage_company) return <Callout tone="info">Only owners and admins can change {company.name}'s settings.</Callout>;
  return (
    <div className="max-w-4xl space-y-5">
      <PageTitle title="Settings" />
      <Profile />
      <CareersSite />
      <DataControls />
      <Templates />
    </div>
  );
}

export function PlanPage() {
  const { company } = useCompany();
  const [data, setData] = useState<BizPlanStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState<BizPlan | null>(null);
  useEffect(() => {
    biz.plan(company.id).then(setData).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  const inr = company.country === "IN";
  return (
    <div className="max-w-4xl space-y-5">
      <PageTitle
        title="Plan"
        subtitle={`${PLAN_LABEL[data.plan]}${data.plan_until ? ` until ${new Date(data.plan_until).toLocaleDateString()}` : ""}: ${data.active_jobs} of ${data.limits.jobs} active jobs, ${data.seats_used} of ${data.limits.seats} seats.`}
      />
      {data.pending_request && (
        <Callout tone="info">
          You asked for {PLAN_LABEL[data.pending_request.plan]} {relTime(data.pending_request.created_at)}. The Orbit team will be in touch by email to set it up.
        </Callout>
      )}
      <ul className="grid gap-3 md:grid-cols-3">
        {data.plans.map((p) => (
          <li key={p.id} className={`rounded-2xl border p-4 ${p.id === data.plan ? "border-indigo-500 ring-1 ring-indigo-500" : "border-zinc-200 dark:border-white/10"}`}>
            <h2 className="font-semibold">{p.label}</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {p.price_inr === 0 ? "Free" : inr ? `₹${p.price_inr.toLocaleString("en-IN")}` : `$${p.price_usd}`}
              {p.price_inr > 0 && <span className="text-sm font-normal text-zinc-500"> / month{inr ? " + GST" : ""}</span>}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              <li>{p.jobs === 1 ? "1 active job" : `${p.jobs} active jobs`}</li>
              <li>{p.seats === 1 ? "1 seat" : `${p.seats} seats`}</li>
              <li>Careers page, Google for Jobs, AI ranking with reasons</li>
              {p.invite_only && <li>By invitation</li>}
            </ul>
            {p.id !== data.plan && p.id !== "free" && company.role === "owner" && (
              <Button
                className="mt-4"
                size="sm"
                variant={p.id === "starter" ? "primary" : "secondary"}
                loading={busy === p.id}
                disabled={data.pending_request?.plan === p.id}
                onClick={async () => {
                  setBusy(p.id);
                  try {
                    setData(await biz.requestPlan(company.id, p.id));
                    toast({ message: "Request sent. The Orbit team will email you.", tone: "success" });
                  } catch (e) {
                    toast({ message: errorText(e), tone: "error" });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {p.invite_only ? `Ask about ${p.label}` : `Upgrade to ${p.label}`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Paying by card or UPI in the app is coming. For now an upgrade is a request: the Orbit team confirms the plan and sets it up for you. Saba interviews for companies are coming soon.</p>
      {company.role !== "owner" && <p className="text-sm">Only the owner can change the plan.</p>}
    </div>
  );
}

export function AuditPage() {
  const { company } = useCompany();
  const [items, setItems] = useState<BizAuditEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const load = async (before?: string) => {
    try {
      const page = await biz.audit(company.id, before);
      setItems((prev) => [...(before ? (prev ?? []) : []), ...page]);
      setMore(page.length >= 50);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id]);
  if (!company.permissions.view_audit) return <Callout tone="info">Only owners and admins can see the audit log.</Callout>;
  if (error) return <LoadError error={error} />;
  if (!items) return <Loading />;
  return (
    <div className="space-y-4">
      <PageTitle title="Audit log" subtitle="Every action your team takes on jobs, applicants and members, and each ranking's model version. It can't be edited." />
      <Table label="Audit log" dense stack>
        <THead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>What</Th>
            <Th>Details</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((e) => (
            <Tr key={e.id}>
              <Td label="When">{new Date(e.created_at).toLocaleString()}</Td>
              <Td label="Who">{e.actor ?? "Orbit"}</Td>
              <Td label="What" primary>
                {e.action}
                {e.target && <span className="block text-xs font-normal text-zinc-500">{e.target}</span>}
              </Td>
              <Td label="Details">
                <code className="break-all text-xs">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""}</code>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {more && items.length > 0 && (
        <Button variant="secondary" onClick={() => void load(items[items.length - 1]!.created_at)}>
          Older entries
        </Button>
      )}
    </div>
  );
}
