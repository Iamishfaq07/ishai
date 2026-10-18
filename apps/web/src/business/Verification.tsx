// Orbit for Business (D82): proving the company is who it says (a work email at its domain, or a DNS record), which
// is what stops fake employers and job scams. Unverified companies can draft jobs but not publish them.
import { useEffect, useId, useState, type FormEvent } from "react";
import type { BizVerification } from "@orbit/types";
import { BadgeCheck, Button, Callout, CopyButton, Field, Input, Mail, toast } from "@orbit/ui";
import { biz } from "./api";
import { useCompany, PageTitle } from "./BusinessApp";
import { EMAIL_RE } from "./model";
import { Loading, LoadError, Panel, errorText } from "./ui";

export function Verification() {
  const { company, reload } = useCompany();
  const id = useId();
  const [v, setV] = useState<BizVerification | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    biz.verification(company.id).then(setV).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id]);

  const run = async (what: string, fn: () => Promise<BizVerification>, okText?: string) => {
    setBusy(what);
    setProblem(null);
    try {
      const next = await fn();
      setV(next);
      if (next.verified) {
        toast({ message: `${company.name} is verified. You can publish jobs now.`, tone: "success" });
        reload();
      } else if (okText) toast({ message: okText, tone: "success" });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <LoadError error={error} />;
  if (!v) return <Loading />;
  const canEdit = company.permissions.manage_company;

  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle title="Verify your company" subtitle={`Show that you work at ${v.domain}. It's what lets your jobs go live, and what protects job seekers from fake employers.`} />
      {v.verified ? (
        <Callout tone="success" icon={<BadgeCheck className="h-4 w-4" />} title={`${company.name} is verified`}>
          Verified {v.method === "dns" ? "with a DNS record" : v.method === "admin" ? "by the Orbit team" : "with a work email"} on {v.domain}. Your careers page shows a "Verified company" badge.
        </Callout>
      ) : v.blocked_domain ? (
        <Callout tone="error" title={`${v.domain} can't be verified`}>
          It's a free email or hosting domain anyone can use. Change the website in Settings to your company's own domain, or contact the Orbit team.
        </Callout>
      ) : !canEdit ? (
        <Callout tone="info">Ask an owner or admin of {company.name} to verify the company.</Callout>
      ) : (
        <>
          {v.account_email_matches && (
            <Panel title="Your sign-in email is at this domain" hint="One click: your Orbit account's verified email already proves it.">
              <Button loading={busy === "account"} onClick={() => void run("account", () => biz.verifyWithAccount(company.id))}>
                Verify with my email
              </Button>
            </Panel>
          )}
          <Panel title="Option 1: a work email" hint={`We send a 6-digit code to an address at ${v.domain}.`}>
            <form
              className="flex flex-wrap items-end gap-2"
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!EMAIL_RE.test(email) || !email.toLowerCase().endsWith(`@${v.domain}`)) return setProblem(`Use an address that ends in @${v.domain}.`);
                void run("send", () => biz.sendVerifyEmail(company.id, email.trim()), "Code sent. Check that inbox.");
              }}
            >
              <div className="min-w-[16rem] flex-1">
                <Field label="Work email" htmlFor={`${id}-e`}>
                  <Input id={`${id}-e`} type="email" autoComplete="email" placeholder={`you@${v.domain}`} value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="secondary" loading={busy === "send"}>
                <Mail className="h-4 w-4" aria-hidden /> Send code
              </Button>
            </form>
            {v.pending_email && (
              <form
                className="mt-4 flex flex-wrap items-end gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run("code", () => biz.confirmVerifyEmail(company.id, code.trim()));
                }}
              >
                <div className="w-40">
                  <Field label={`Code sent to ${v.pending_email}`} htmlFor={`${id}-c`}>
                    <Input id={`${id}-c`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                </div>
                <Button type="submit" disabled={code.length !== 6} loading={busy === "code"}>
                  Verify
                </Button>
              </form>
            )}
          </Panel>
          <Panel title="Option 2: a DNS record" hint="If you manage the domain's DNS: add this TXT record, wait a few minutes, then check.">
            <dl className="grid gap-3 text-sm sm:grid-cols-[6rem_1fr]">
              <dt className="text-zinc-600 dark:text-zinc-400">Type</dt>
              <dd className="font-mono">{v.dns.type}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Host / name</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/5">{v.dns.host}</code>
                <CopyButton text={v.dns.host} label="Copy host" />
              </dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Value</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-white/5">{v.dns.value}</code>
                <CopyButton text={v.dns.value} label="Copy value" />
              </dd>
            </dl>
            <Button className="mt-4" variant="secondary" loading={busy === "dns"} onClick={() => void run("dns", () => biz.checkDns(company.id), "We couldn't see the record yet. DNS can take up to an hour.")}>
              Check the record
            </Button>
          </Panel>
        </>
      )}
      {problem && <Callout tone="error">{problem}</Callout>}
    </div>
  );
}
