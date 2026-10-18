// Orbit for Business (D82): the company's members and invites, their roles, and handing over ownership.
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { BizMembers, BizRole } from "@orbit/types";
import { Button, Callout, Field, Input, Select, Table, THead, Td, Th, Tr, UserPlus, buttonClass, confirmDialog, toast } from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import { EMAIL_RE, INVITABLE_ROLES, ROLE_HINT, ROLE_LABEL, companyPath, relTime } from "./model";
import { Loading, LoadError, Panel, RoleBadge, errorCode, errorText } from "./ui";

export function Team() {
  const { company, reload: reloadCompany } = useCompany();
  const id = useId();
  const [data, setData] = useState<BizMembers | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BizRole>("recruiter");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    biz.members(company.id).then(setData).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [company.id]);
  const manage = company.permissions.manage_members && company.status === "active";

  const run = async (fn: () => Promise<BizMembers>, done: string) => {
    try {
      setData(await fn());
      toast({ message: done, tone: "success" });
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setProblem("Add their email address.");
    setBusy(true);
    setProblem(null);
    try {
      setData(await biz.invite(company.id, email.trim(), role));
      toast({ message: `Invite sent to ${email.trim()}`, tone: "success" });
      setEmail("");
    } catch (err) {
      setProblem(errorCode(err) === "biz_limit" ? `${errorText(err)}` : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <LoadError error={error} />;
  if (!data) return <Loading />;
  const full = data.seats_used >= data.seats;

  return (
    <div className="space-y-5">
      <PageTitle title="Team" subtitle={`${data.seats_used} of ${data.seats} seats used (members and open invites).`} />
      {manage && (
        <Panel title="Invite a teammate" hint="They sign in with their own Orbit account. What they do here stays apart from their own Orbit.">
          {full ? (
            <Callout tone="info" action={<Link to={companyPath(company.id, "plan")} className={buttonClass("secondary", "sm")}>See plans</Link>}>
              Every seat is in use. Remove someone or move to a bigger plan to invite more.
            </Callout>
          ) : (
            <form onSubmit={invite} noValidate className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
              <Field label="Email" htmlFor={`${id}-e`}>
                <Input id={`${id}-e`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Role" htmlFor={`${id}-r`} hint={ROLE_HINT[role]}>
                <Select id={`${id}-r`} value={role} onChange={(e) => setRole(e.target.value as BizRole)}>
                  {INVITABLE_ROLES.filter((r) => r !== "admin" || company.role === "owner" || company.role === "admin").map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" loading={busy} className="sm:mb-5">
                <UserPlus className="h-4 w-4" aria-hidden /> Invite
              </Button>
            </form>
          )}
          {problem && <Callout tone="error" className="mt-3">{problem}</Callout>}
        </Panel>
      )}

      <Table label="Members" dense stack>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Joined</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <tbody>
          {data.members.map((m) => (
            <Tr key={m.id}>
              <Td primary>
                {m.name || m.email}
                {m.you && " (you)"}
                <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{m.email}</span>
              </Td>
              <Td label="Role">
                {manage && m.role !== "owner" && !m.you ? (
                  <Select aria-label={`Role for ${m.name || m.email}`} className="!w-auto !py-1" value={m.role} onChange={(e) => void run(() => biz.setRole(company.id, m.id, e.target.value as BizRole), "Role changed")}>
                    {INVITABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </Td>
              <Td label="Joined">{relTime(m.joined_at)}</Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1">
                  {company.role === "owner" && !m.you && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: `Make ${m.name || m.email} the owner?`, body: "They get the plan and ownership; you become an admin. Only they can hand it back.", confirmLabel: "Transfer ownership", typeToConfirm: "TRANSFER" }))) return;
                        await run(() => biz.transfer(company.id, m.id), "Ownership transferred");
                        reloadCompany();
                      }}
                    >
                      Make owner
                    </Button>
                  )}
                  {manage && m.role !== "owner" && !m.you && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirmDialog({ title: `Remove ${m.name || m.email}?`, body: "They lose access to this company at once. Their notes and scorecards stay.", confirmLabel: "Remove", danger: true }))
                          await run(() => biz.removeMember(company.id, m.id), "Removed");
                      }}
                    >
                      Remove
                    </Button>
                  )}
                  {m.you && m.role !== "owner" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: `Leave ${company.name}?`, confirmLabel: "Leave", danger: true }))) return;
                        try {
                          await biz.leave(company.id);
                          window.location.assign("/business/app");
                        } catch (e) {
                          toast({ message: errorText(e), tone: "error" });
                        }
                      }}
                    >
                      Leave
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      {data.invites.length > 0 && (
        <Panel title="Open invites">
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-white/10">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i.email} · {ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}
                </span>
                {manage && (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => biz.cancelInvite(company.id, i.id), "Invite cancelled")}>
                    Cancel invite
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
