// Orbit for Business (D82): the company app at /business/app/*, its own area apart from the candidate app (its own
// header and navigation, the same Orbit sign-in). Lazy-loaded as its own chunks: nothing here is in a candidate's
// first download.
import { Suspense, createContext, lazy, useContext, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { BizCompany, BizCompanySize, BizMe, BizNotification } from "@orbit/types";
import {
  ArrowRight,
  Bell,
  Briefcase,
  Building2,
  Button,
  COUNTRIES,
  Callout,
  CreditCard,
  EmptyState,
  Field,
  Input,
  Gauge,
  ScrollText,
  Select,
  SettingsIcon,
  ShieldCheck,
  Textarea,
  Users,
  buttonClass,
  cx,
  focusRing,
  toast,
} from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { biz } from "./api";
import { APP_HOME, ROLE_LABEL, companyPath, domainOf, relTime } from "./model";
import { Loading, LoadError, PLAN_LABEL, Panel, RoleBadge, errorText } from "./ui";

const Dashboard = lazy(async () => ({ default: (await import("./Dashboard")).Dashboard }));
const Verification = lazy(async () => ({ default: (await import("./Verification")).Verification }));
const JobsList = lazy(async () => ({ default: (await import("./Jobs")).JobsList }));
const JobEditor = lazy(async () => ({ default: (await import("./Jobs")).JobEditor }));
const Pipeline = lazy(async () => ({ default: (await import("./Pipeline")).Pipeline }));
const Candidate = lazy(async () => ({ default: (await import("./Candidate")).Candidate }));
const HiringDesk = lazy(async () => ({ default: (await import("./HiringDesk")).HiringDeskPage }));
const AutomationCenter = lazy(async () => ({ default: (await import("./AutomationCenter")).AutomationCenter }));
const RequisitionDesk = lazy(async () => ({ default: (await import("./RequisitionDesk")).RequisitionDesk }));
const ControlRoom = lazy(async () => ({ default: (await import("./ControlRoom")).ControlRoom }));
const HiringPlan = lazy(async () => ({ default: (await import("./HiringPlan")).HiringPlanPage }));
const HiringRoom = lazy(async () => ({ default: (await import("./HiringRoom")).HiringRoomPage }));
const CandidateCompare = lazy(async () => ({ default: (await import("./CandidateCompare")).CandidateComparePage }));
const Team = lazy(async () => ({ default: (await import("./Team")).Team }));
const SettingsPage = lazy(async () => ({ default: (await import("./Settings")).CompanySettings }));
const PlanPage = lazy(async () => ({ default: (await import("./Settings")).PlanPage }));
const AuditPage = lazy(async () => ({ default: (await import("./Settings")).AuditPage }));

// ---- the company in context ---------------------------------------------------------------------------------------

interface CompanyCtx {
  company: BizCompany;
  reload: () => void;
  setCompany: (c: BizCompany) => void;
}
const Ctx = createContext<CompanyCtx | null>(null);

export function useCompany(): CompanyCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCompany outside a company");
  return c;
}

// ---- the shell ----------------------------------------------------------------------------------------------------

function Header({ company }: { company?: BizCompany | undefined }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    biz
      .notifications()
      .then((n) => setUnread(n.filter((x) => !x.read).length))
      .catch(() => undefined);
  }, [company?.id]);
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to={APP_HOME} className={cx("flex shrink-0 items-center gap-2 rounded font-semibold", focusRing)}>
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">O</span>
          <span className="sr-only sm:not-sr-only">
            Orbit <span className="font-normal text-zinc-500 dark:text-zinc-400">for Business</span>
          </span>
        </Link>
        {company && (
          <>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">/</span>
            <Link to={companyPath(company.id)} className={cx("min-w-0 truncate rounded text-sm font-medium", focusRing)}>
              {company.name}
            </Link>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link to={`${APP_HOME}/notifications`} className={cx("relative inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5", focusRing)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
            <Bell className="h-4 w-4" aria-hidden />
            {unread > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-600" />}
          </Link>
          <WorkspaceSwitch />
          <Link to="/tools?audience=business" className={cx("rounded text-xs hover:underline", focusRing)}>Tools</Link>
          <span className="hidden max-w-[12rem] truncate text-xs text-zinc-500 dark:text-zinc-400 md:inline" title={user?.email}>
            {user?.email}
          </span>
        </div>
      </div>
    </header>
  );
}

const NAV = [
  { to: "", label: "Dashboard", icon: Gauge, end: true },
  { to: "control-room", label: "Control room", icon: Gauge },
  { to: "jobs", label: "Jobs", icon: Briefcase },
  { to: "requisitions", label: "Hiring requests", icon: ScrollText },
  { to: "hiring-desk", label: "Hiring desk", icon: Users },
  { to: "automations", label: "Automations", icon: Gauge },
  { to: "team", label: "Team", icon: Users },
  { to: "settings", label: "Settings", icon: SettingsIcon },
  { to: "plan", label: "Plan", icon: CreditCard },
  { to: "audit", label: "Audit log", icon: ScrollText },
] as const;

function CompanyNav({ company, sidebar = false }: { company: BizCompany; sidebar?: boolean }) {
  const items = NAV.filter((n) => ((n.to === "control-room" || n.to === "requisitions") ? company.role !== "interviewer" : n.to === "automations" ? company.permissions.move_applicants : n.to === "audit" ? company.permissions.view_audit : n.to === "plan" ? company.role === "owner" || company.role === "admin" : n.to === "settings" ? company.permissions.manage_company : true));
  return (
    <nav aria-label={`${company.name}`} className={sidebar ? "hidden w-60 shrink-0 space-y-6 border-r border-zinc-200 p-4 dark:border-white/10 lg:block" : "border-b border-zinc-200 dark:border-white/10 lg:hidden"}>
      {sidebar && <div className="space-y-3 rounded-xl bg-zinc-950 p-4 text-white"><p className="text-xsst text-indigo-300">Company workspace</p><p className="truncate font-semibold">{company.name}</p><p className="text-xs text-zinc-300">{ROLE_LABEL[company.role]} · {company.verified ? "Verified" : "Verification pending"}</p></div>}
      <ul className={sidebar ? "space-y-1" : "mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6"}>
        {items.map((n) => (
          <li key={n.to}>
            <NavLink
              to={companyPath(company.id, n.to)}
              end={"end" in n ? n.end : false}
              className={({ isActive }) =>
                cx(
                  sidebar ? "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors motion-reduce:transition-none" : "inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-sm",
                  isActive ? sidebar ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-white/10 dark:text-indigo-300" : "border-indigo-600 font-medium text-zinc-900 dark:text-white" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )
              }
            >
              <n.icon className="h-4 w-4" aria-hidden /> {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {sidebar && <div className="rounded-xl border border-zinc-200 p-4 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400"><p className="font-semibold">Keep the loop moving</p><p className="mt-2">Prepare roles, coordinate interviews and review evidence in one workspace.</p><Link to="/jobs/weekly" className={cx("mt-3 inline-block rounded font-medium hover:underline", focusRing)}>Your personal weekly studio →</Link></div>}
    </nav>
  );
}

function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main id="main" className={cx("mx-auto w-full px-4 py-6 sm:px-6", wide ? "max-w-7xl" : "max-w-5xl")}>{children}</main>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  useDocumentTitle(`${title} · Orbit for Business`, null, true);
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function Banners({ company }: { company: BizCompany }) {
  if (company.status === "suspended") {
    return (
      <Callout tone="error" title="This company is suspended by the Orbit team" className="mb-5">
        Its jobs are hidden and nothing can be changed. {company.suspended_reason ? `Reason: ${company.suspended_reason}` : ""} Contact the Orbit team if you think this is a mistake.
      </Callout>
    );
  }
  if (!company.verified) {
    return (
      <Callout tone="warning" title="Verify your company to publish jobs" className="mb-5" action={<Link to={companyPath(company.id, "verify")} className={buttonClass("secondary", "sm")}>Verify</Link>}>
        Until then you can draft jobs and set up your team; they go live once {company.domain} is verified.
      </Callout>
    );
  }
  return null;
}

function CompanyLayout() {
  const { cid = "" } = useParams();
  const [company, setCompany] = useState<BizCompany | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    biz
      .company(cid)
      .then((c) => live && setCompany(c))
      .catch((e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      live = false;
    };
  }, [cid, n]);
  const reload = () => setN((x) => x + 1);
  if (error)
    return (
      <>
        <Header />
        <Page>
          {(error as { status?: number }).status === 404 ? (
            <EmptyState kind="no-results" title="This company isn't yours" body="It doesn't exist, or you aren't a member of it." action={<Link to={APP_HOME} className={buttonClass("secondary")}>Your companies</Link>} />
          ) : (
            <LoadError error={error} onRetry={reload} />
          )}
        </Page>
      </>
    );
  if (!company || company.id !== cid)
    return (
      <>
        <Header />
        <Page>
          <Loading />
        </Page>
      </>
    );
  return (
    <Ctx.Provider key={company.id} value={{ company, reload, setCompany }}>
      <Header company={company} />
      <CompanyNav company={company} />
      <div className="mx-auto flex w-full max-w-7xl">
      <CompanyNav company={company} sidebar />
      <div className="min-w-0 flex-1">
      <Page wide>
        <Banners company={company} />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="verify" element={<Verification />} />
            <Route path="jobs" element={<JobsList />} />
            <Route path="jobs/new" element={<JobEditor />} />
            <Route path="jobs/:jid" element={<Pipeline />} />
            <Route path="jobs/:jid/edit" element={<JobEditor />} />
            <Route path="hiring-desk" element={<HiringDesk />} />
            <Route path="automations" element={<AutomationCenter />} />
            <Route path="control-room" element={<ControlRoom />} />
            <Route path="requisitions" element={<RequisitionDesk />} />
            <Route path="jobs/:jid/interview-plan" element={<HiringPlan />} />
            <Route path="jobs/:jid/compare" element={<CandidateCompare />} />
            <Route path="applications/:aid" element={<Candidate />} />
            <Route path="applications/:aid/interview" element={<HiringRoom />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to={companyPath(company.id)} replace />} />
          </Routes>
        </Suspense>
      </Page>
      </div>
      </div>
    </Ctx.Provider>
  );
}

// ---- your companies -----------------------------------------------------------------------------------------------

function CompaniesHome() {
  const [search] = useSearchParams();
  const wanted = search.get("tool") ?? "";
  const tool = ["jobs", "jobs/new", "hiring-desk", "control-room", "requisitions", "automations", "team"].includes(wanted) ? wanted : "";
  const [me, setMe] = useState<BizMe | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    biz.me().then(setMe).catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [n]);
  return (
    <>
      <Header />
      <Page>
        <PageTitle title="Your companies" subtitle="Hire with Orbit: a careers page, one-click applies and a pipeline your team shares." actions={<Link to={`${APP_HOME}/new`} className={buttonClass("primary")}>Add a company</Link>} />
        {tool && <p className="mb-4 text-sm text-indigo-700 dark:text-indigo-300">Choose a company to open {tool.replaceAll("-", " ").replaceAll("/", " · ")}. Your company permissions apply.</p>}
        {error ? (
          <LoadError error={error} onRetry={() => setN((x) => x + 1)} />
        ) : !me ? (
          <Loading />
        ) : (
          <div className="space-y-6">
            {me.invites.length > 0 && (
              <Panel title="Invites for you">
                <ul className="divide-y divide-zinc-200 dark:divide-white/10">
                  {me.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <span>
                        <strong>{i.company_name}</strong> invited you as {ROLE_LABEL[i.role]}
                        {i.invited_by ? ` (from ${i.invited_by})` : ""}. Open the link in the invite email to join.
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {me.companies.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No company yet"
                body="Add your company to post jobs on a careers page that Google for Jobs reads, and review applicants with your team. A person always decides; Orbit's ranking only sorts."
                action={<Link to={`${APP_HOME}/new`} className={buttonClass("primary")}>Add your company</Link>}
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {me.companies.map((c) => (
                  <li key={c.id}>
                    <Link to={companyPath(c.id, tool)} className={cx("flex items-center gap-3 rounded-2xl border border-zinc-200 p-4 hover:border-indigo-400 dark:border-white/10", focusRing)}>
                      {c.logo_url ? (
                        <img src={c.logo_url} alt="" width={40} height={40} className="h-10 w-10 rounded-lg border border-zinc-200 object-contain dark:border-white/10" />
                      ) : (
                        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 font-semibold dark:bg-white/5">
                          {c.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                          <RoleBadge role={c.role} /> {PLAN_LABEL[c.plan]}
                          {!c.verified && " · not verified"}
                          {c.status === "suspended" && " · suspended"}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              Your own Orbit (practice, resumes, sessions, LinkedIn) is never shown to a company, including yours. A company sees only what someone sends it when they apply.
            </p>
          </div>
        )}
      </Page>
    </>
  );
}

const SIZES: BizCompanySize[] = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

function CreateCompany() {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [size, setSize] = useState<BizCompanySize>("1-10");
  const [country, setCountry] = useState("IN");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const domain = domainOf(website);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || !domain) return;
    setBusy(true);
    setError(null);
    try {
      const c = await biz.createCompany({ name: name.trim(), website: website.trim(), size, country, about: about.trim() });
      toast({ message: `${c.name} is set up`, tone: "success" });
      navigate(companyPath(c.id, "verify"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Header />
      <Page>
        <PageTitle title="Add your company" subtitle="Next you'll verify it with a work email or a DNS record. Until then you can draft jobs." />
        <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
          <Field label="Company name" htmlFor={`${id}-n`} required error={touched && !name.trim() ? "Add the company's name." : null}>
            <Input id={`${id}-n`} value={name} maxLength={160} autoComplete="organization" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Website" htmlFor={`${id}-w`} required hint={domain ? `Verified through ${domain}` : "Your company's own site, like acme.com"} error={touched && !domain ? "Add the company's website, like acme.com." : null}>
            <Input id={`${id}-w`} value={website} inputMode="url" autoComplete="url" placeholder="acme.com" maxLength={300} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="About (optional)" htmlFor={`${id}-a`} hint="Shown on your careers page." counter={{ value: about.length, max: 2000 }}>
            <Textarea id={`${id}-a`} rows={4} maxLength={2000} value={about} onChange={(e) => setAbout(e.target.value)} />
          </Field>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">You can add a logo in Settings once the company is set up.</p>
          {error && <Callout tone="error">{error}</Callout>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Create company
            </Button>
            <Link to={APP_HOME} className={buttonClass("secondary")}>
              Cancel
            </Link>
          </div>
        </form>
      </Page>
    </>
  );
}

/** A company's country (ISO code), from the same list the candidate app offers. */
export function CountryPick({ value, onChange, label = "Country" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// ---- notifications ------------------------------------------------------------------------------------------------

function Notifications() {
  const [items, setItems] = useState<BizNotification[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    biz
      .notifications()
      .then((n) => {
        setItems(n);
        const unread = n.filter((x) => !x.read).map((x) => x.id);
        if (unread.length) void biz.readNotifications(unread).catch(() => undefined);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);
  return (
    <>
      <Header />
      <Page>
        <PageTitle title="Notifications" subtitle="Team mentions, hiring follow-ups and scheduling requests." />
        {error ? (
          <LoadError error={error} />
        ) : !items ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing yet" body="Team mentions and assigned hiring follow-ups appear here. Mentions can also arrive by email." />
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 p-3.5 text-sm">
                {!n.read && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600">
                    <span className="sr-only">New:</span>
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <Link to={n.link} className={cx("rounded font-medium hover:underline", focusRing)}>
                    {n.text}
                  </Link>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {n.company_name} · {relTime(n.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}

// ---- the app's routes ---------------------------------------------------------------------------------------------

export function BusinessApp() {
  return (
    <div className="min-h-full bg-zinc-50/60 dark:bg-zinc-950">
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<CompaniesHome />} />
          <Route path="new" element={<CreateCompany />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path=":cid/*" element={<CompanyLayout />} />
        </Routes>
      </Suspense>
    </div>
  );
}

import { WorkspaceSwitch } from "../components/WorkspaceSwitch";
