import { useState, type ReactNode } from "react";
import {
  AnswersScene,
  Avatar,
  Badge,
  BillingScene,
  Breadcrumbs,
  Button,
  ButtonGroup,
  Callout,
  Card,
  CelebrationScene,
  Checkbox,
  CodeScene,
  CopilotScene,
  CosmicEmptyState,
  DialogActions,
  DocumentsScene,
  EvidenceScene,
  Field,
  IconButton,
  IconTile,
  InboxScene,
  Input,
  InterviewDayScene,
  JobsScene,
  Kbd,
  LearningScene,
  LinkedInScene,
  MenuButton,
  NoResultsScene,
  OfferScene,
  OfflineScene,
  PageHeader,
  Pagination,
  Popover,
  PracticeScene,
  ProgressBar,
  RadioGroup,
  ReferralScene,
  ResumeScene,
  SearchInput,
  SecurityScene,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Slider,
  SplitButton,
  StatTile,
  Stepper,
  StoriesScene,
  TabPanel,
  Table,
  TableEmpty,
  Tabs,
  Td,
  Textarea,
  THead,
  Th,
  Toggle,
  Tooltip,
  Tr,
  TrackerScene,
  VideoScene,
  WelcomeScene,
  WorkingState,
  confirmDialog,
  toast,
  Download,
  Ellipsis,
  LayoutGrid,
  PenLine,
  Plus,
  Trash2,
  type SortDirection,
} from "@orbit/ui";

/**
 * The component gallery (development builds only, at /dev/components): every shared primitive in its states, on the
 * workbench, so a change to one shows everywhere it's used and new work starts from what exists. DESIGN.md has the
 * rules; this is what they look like.
 */
export function ComponentGalleryPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        icon={LayoutGrid}
        title="Component gallery"
        subtitle="The workbench's shared components and their states. Development builds only."
        actions={<Button variant="secondary" onClick={() => document.documentElement.classList.toggle("dark")}>Toggle theme</Button>}
      />
      <Buttons />
      <Feedback />
      <Overlays />
      <Forms />
      <Data />
      <Illustrations />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`g-${title}`} className="space-y-4">
      <h2 id={`g-${title}`} className="font-display text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Buttons() {
  const [busy, setBusy] = useState(false);
  const [pressed, setPressed] = useState(true);
  return (
    <Section title="Buttons">
      <Card className="space-y-4">
        <Row label="Variants">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row label="States">
          <Button loading={busy} onClick={() => setBusy(true)} onBlur={() => setBusy(false)}>
            Save changes
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary" aria-pressed={pressed} onClick={() => setPressed((p) => !p)}>
            Pressed: {pressed ? "on" : "off"}
          </Button>
          <Button block>Full width on phones</Button>
        </Row>
        <Row label="Icon only">
          <IconButton icon={PenLine} label="Edit" />
          <IconButton icon={Trash2} label="Delete" className="hover:!bg-rose-500/10 hover:!text-rose-700" />
          <IconButton icon={Plus} label="Add" variant="secondary" />
          <IconButton icon={Plus} label="Add" variant="primary" size="sm" />
        </Row>
        <Row label="Groups and menus">
          <ButtonGroup label="View">
            <Button variant="secondary" aria-pressed>
              Board
            </Button>
            <Button variant="secondary">List</Button>
          </ButtonGroup>
          <SplitButton
            onClick={() => toast("Downloaded the PDF")}
            menuLabel="More download options"
            items={[
              { label: "Word", onSelect: () => toast("Downloaded Word") },
              { label: "JSON Resume", onSelect: () => toast("Downloaded JSON") },
            ]}
          >
            <Download className="h-4 w-4" aria-hidden /> Download PDF
          </SplitButton>
          <MenuButton
            label="Sort"
            items={[
              { label: "Best match", onSelect: () => toast("Sorted by best match") },
              { label: "Newest", onSelect: () => toast("Sorted by newest") },
            ]}
          />
          <MenuButton
            label="More actions"
            icon={Ellipsis}
            variant="ghost"
            align="end"
            items={[
              { label: "Rename", icon: PenLine, onSelect: () => toast("Rename") },
              { label: "Delete", icon: Trash2, danger: true, onSelect: () => toast({ message: "Deleted", action: { label: "Undo", onClick: () => toast("Restored") } }) },
            ]}
          />
        </Row>
      </Card>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback">
      <Card className="space-y-4">
        <Row label="Badges">
          <Badge>Neutral</Badge>
          <Badge tone="accent">New</Badge>
          <Badge tone="success" dot>
            Ready
          </Badge>
          <Badge tone="warning" dot>
            Waiting
          </Badge>
          <Badge tone="danger" dot>
            Failed
          </Badge>
          <Badge tone="info">Info</Badge>
        </Row>
        <Row label="Shortcuts">
          <span className="text-sm">
            Search with <Kbd>Ctrl K</Kbd> or <Kbd>/</Kbd>
          </span>
        </Row>
        <Row label="Toasts">
          <Button variant="secondary" size="sm" onClick={() => toast("Copied")}>
            Neutral
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast({ message: "Saved to tracker", tone: "success" })}>
            Success
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast({ message: "Saved, but the file was too big", detail: "Only the first 10 MB were read.", tone: "warning" })}>
            Warning
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast({ message: "Couldn't save", detail: "Check your connection, then try again.", tone: "error" })}>
            Error
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast({ message: "Story deleted", action: { label: "Undo", onClick: () => toast("Restored") } })}>
            With Undo
          </Button>
        </Row>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Callout title="A note">Information that helps, in the page's flow.</Callout>
        <Callout tone="success" title="Saved">Your resume is in Documents now.</Callout>
        <Callout tone="warning" title="Check this" action={<Button size="sm" variant="secondary">Review</Button>}>
          The job post changed since you tailored this resume.
        </Callout>
        <Callout tone="error" onDismiss={() => undefined}>
          Couldn't reach the job boards. Try again in a minute.
        </Callout>
      </div>
    </Section>
  );
}

function Overlays() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Overlays">
      <Card className="space-y-4">
        <Row label="Dialog">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open a dialog
          </Button>
          <Button
            variant="secondary"
            onClick={() => void confirmDialog({ title: "Delete this resume?", body: "Its versions go too. This can't be undone.", confirmLabel: "Delete", danger: true })}
          >
            Destructive confirm
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void confirmDialog({ title: "Delete your account?", body: "Everything goes, now.", confirmLabel: "Delete my account", danger: true, typeToConfirm: "DELETE" })
            }
          >
            Typed confirm
          </Button>
        </Row>
        <Row label="Popover and tooltip">
          <Popover
            label="Filters"
            trigger={(p) => (
              <Button {...p} variant="secondary">
                Filters
              </Button>
            )}
          >
            {(close) => (
              <div className="space-y-3">
                <Checkbox label="Remote only" />
                <Checkbox label="Posted this week" defaultChecked />
                <Button size="sm" onClick={close}>
                  Apply
                </Button>
              </div>
            )}
          </Popover>
          <Tooltip content="Opens the command palette">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
        </Row>
      </Card>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add a job you found elsewhere"
        size="md"
        footer={
          <DialogActions>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Add to tracker</Button>
          </DialogActions>
        }
      >
        <div className="space-y-4 px-5 py-4">
          <Field label="Company" htmlFor="g-company" required>
            <Input id="g-company" placeholder="e.g. Stripe" />
          </Field>
          <Field label="Notes (optional)" htmlFor="g-notes" hint="Who referred you, the next step.">
            <Textarea id="g-notes" rows={3} />
          </Field>
        </div>
      </Sheet>
    </Section>
  );
}

function Forms() {
  const [motion, setMotion] = useState<"full" | "reduced" | "off">("reduced");
  const [level, setLevel] = useState<"entry" | "mid" | "senior">("mid");
  const [on, setOn] = useState(true);
  const [note, setNote] = useState("Led the billing migration");
  return (
    <Section title="Forms">
      <Card className="grid gap-5 md:grid-cols-2">
        <Field label="Job title" htmlFor="g-title" required hint="As job posts write it.">
          <Input id="g-title" defaultValue="Product Analyst" />
        </Field>
        <Field label="Company" htmlFor="g-co" required error="Add a company name, so the message can name it.">
          <Input id="g-co" />
        </Field>
        <Field label="Country" htmlFor="g-country">
          <Select id="g-country" defaultValue="IN">
            <option value="IN">India</option>
            <option value="US">United States</option>
          </Select>
        </Field>
        <Field label="Start date" htmlFor="g-date">
          <Input id="g-date" type="date" />
        </Field>
        <Field label="What you did" htmlFor="g-note" counter={{ value: note.length, max: 40 }}>
          <Textarea id="g-note" rows={2} value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Search</p>
          <SearchInput aria-label="Search jobs" placeholder="Search jobs" />
        </div>
        <div className="space-y-3">
          <Checkbox label="Email me new matches" description="Once a day, only when there are new ones." defaultChecked />
          <Checkbox label="Disabled" disabled />
        </div>
        <RadioGroup
          legend="Experience level"
          name="g-level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "entry", label: "Entry level" },
            { value: "mid", label: "Mid level" },
            { value: "senior", label: "Senior" },
          ]}
        />
        <Toggle checked={on} onChange={setOn} label="Read answers aloud" description="The interviewer's voice, in mock rounds." />
        <Slider label="Bonus paid out" valueText="80%" min={0} max={100} defaultValue={80} />
        <div className="space-y-1.5">
          <p id="g-motion" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Animations
          </p>
          <SegmentedControl
            labelledBy="g-motion"
            value={motion}
            onChange={setMotion}
            options={[
              { value: "full", label: "Full" },
              { value: "reduced", label: "Gentle" },
              { value: "off", label: "Off" },
            ]}
          />
        </div>
      </Card>
    </Section>
  );
}

function Data() {
  const [tab, setTab] = useState<"review" | "summary" | "transcript">("review");
  const [sort, setSort] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const rows = [
    { name: "Stripe", role: "Product Analyst", stage: "Interviewing", tone: "accent" as const, score: 82 },
    { name: "Figma", role: "Senior Data Analyst", stage: "Applied", tone: "neutral" as const, score: 74 },
    { name: "Atlassian", role: "Product Analyst II", stage: "Offer", tone: "success" as const, score: 91 },
  ];
  const sorted = [...rows].sort((a, b) => (sort === "asc" ? a.score - b.score : b.score - a.score));
  return (
    <Section title="Data">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Applied" value="12" detail="from your tracker" />
        <StatTile label="Heard back" value="42%" detail="5 of 12" />
        <StatTile label="Interviews" value="3" detail="this month" />
        <StatTile label="Typical wait" value="6 days" detail="to an answer" />
      </div>
      <Table label="Applications" stack>
        <THead>
          <tr>
            <Th>Company</Th>
            <Th>Role</Th>
            <Th>Stage</Th>
            <Th align="right" sort={sort} onSort={() => setSort(sort === "desc" ? "asc" : "desc")}>
              Fit
            </Th>
          </tr>
        </THead>
        <tbody>
          {sorted.map((r) => (
            <Tr key={r.name}>
              <Td primary>
                <span className="flex items-center gap-2.5">
                  <Avatar name={r.name} size="sm" /> {r.name}
                </span>
              </Td>
              <Td label="Role">{r.role}</Td>
              <Td label="Stage">
                <Badge tone={r.tone}>{r.stage}</Badge>
              </Td>
              <Td label="Fit" align="right">
                {r.score}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Table label="Empty table">
        <THead>
          <tr>
            <Th>Company</Th>
            <Th>Role</Th>
          </tr>
        </THead>
        <tbody>
          <TableEmpty colSpan={2}>No jobs match these filters.</TableEmpty>
        </tbody>
      </Table>
      <Card className="space-y-5">
        <Pagination page={page} pageSize={20} total={132} onPage={setPage} />
        <ProgressBar label="Resume AI credits" value={7} max={10} valueText="7 of 10" />
        <Stepper steps={["Discover", "Prove", "Prepare", "Apply", "Interview"]} current={2} />
        <Breadcrumbs>{["Jobs AI", "Tracker", "Stripe"]}</Breadcrumbs>
        <div className="flex items-center gap-3">
          <IconTile icon={LayoutGrid} />
          <IconTile icon={LayoutGrid} size="sm" />
          <Avatar name="Jordan Lee" />
          <Avatar name="Sam Rivera" size="lg" />
        </div>
        <div>
          <Tabs
            label="Session"
            idBase="g-session"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "review", label: "Review" },
              { value: "summary", label: "Summary" },
              { value: "transcript", label: "Transcript (12)" },
            ]}
          />
          <TabPanel idBase="g-session" value={tab} className="pt-4 text-sm text-zinc-600 dark:text-zinc-300">
            The {tab} panel.
          </TabPanel>
        </div>
        <Skeleton variant="session-row" count={1} label="Loading a row" />
      </Card>
    </Section>
  );
}

const SCENES: Array<[string, ReactNode]> = [
  ["Welcome", <WelcomeScene key="w" />],
  ["Copilot", <CopilotScene key="c" />],
  ["Practice", <PracticeScene key="p" />],
  ["Resume", <ResumeScene key="r" />],
  ["Jobs", <JobsScene key="j" />],
  ["Tracker", <TrackerScene key="t" />],
  ["Offer", <OfferScene key="o" />],
  ["Stories", <StoriesScene key="s" />],
  ["Answers", <AnswersScene key="a" />],
  ["Evidence", <EvidenceScene key="e" />],
  ["Documents", <DocumentsScene key="d" />],
  ["No results", <NoResultsScene key="n" />],
  ["Offline", <OfflineScene key="f" />],
  ["Nothing heard", <CopilotScene key="q" quiet />],
  ["Success", <CelebrationScene key="cs" />],
  ["LinkedIn AI", <LinkedInScene key="li" />],
  ["Code AI", <CodeScene key="co" />],
  ["Learning AI", <LearningScene key="le" />],
  ["Video interview", <VideoScene key="v" />],
  ["Plan & credits", <BillingScene key="b" />],
  ["Security", <SecurityScene key="se" />],
  ["People and referrals", <ReferralScene key="rf" />],
  ["Inbox and support", <InboxScene key="in" />],
  ["Interview day", <InterviewDayScene key="id" />],
];

function Illustrations() {
  // Remounting the scenes plays their entrance again (at Full motion; Gentle fades, Off shows the final frame).
  const [take, setTake] = useState(0);
  return (
    <Section title="Illustrations and empty states">
      <Row label="Scene motion">
        <Button variant="secondary" onClick={() => setTake((t) => t + 1)}>
          Play the scenes again
        </Button>
      </Row>
      <ul key={take} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {SCENES.map(([name, art]) => (
          <li key={name} className="glass-panel flex flex-col items-center gap-2 rounded-2xl p-4">
            <div className="w-full max-w-[12rem]">{art}</div>
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{name}</p>
          </li>
        ))}
      </ul>
      <CosmicEmptyState
        variant="tracker"
        title="Nothing tracked yet"
        body="Save jobs from your matches, or add one you applied to elsewhere."
        action={<Button>Add a job</Button>}
      />
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">AI waits over two seconds: reading, writing, matching (loops at Full motion only)</p>
      <div key={take} className="grid gap-3 md:grid-cols-3">
        <Card><WorkingState kind="reading" label="Reading your resume" /></Card>
        <Card><WorkingState kind="writing" label="Writing your review" /></Card>
        <Card><WorkingState kind="matching" label="Finding jobs that match your resume" /></Card>
      </div>
      <Card className="max-w-sm"><WorkingState compact kind="writing" label="Writing your letter" /></Card>
      <PageHeader icon={LayoutGrid} title="A product page" subtitle="Its header can carry the product's scene from lg up." art={<CodeScene />} />
    </Section>
  );
}
