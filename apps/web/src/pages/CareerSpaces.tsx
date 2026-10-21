import { Link, useLocation } from "react-router-dom";
import { Reveal, cx, focusRing } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { CareerIdentity } from "./career/CareerIdentity";
import { PreparePage } from "./prepare/PreparePage";
const link = cx("block h-full min-h-14 rounded-xl border border-zinc-200 bg-white p-4 text-sm hover:border-indigo-400 motion-safe:transition-[transform,border-color,box-shadow] motion-safe:hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-zinc-900", focusRing);

/** /prepare and /career share a route: Prepare has its own page; My Career is below. */
export function CareerSpacesPage() {
  const prepare = useLocation().pathname.replace(/\/+$/, "") === "/prepare";
  return prepare ? <PreparePage /> : <MyCareer />;
}

/** Contextual destinations into existing tools; no extra candidate records or AI generation. Every group in view. */
function MyCareer() {
  const { user } = useAuth();
  const groups = [
    { title: "My experience", items: [["/jobs?work=resume", "Resume", "Build, import or edit one section at a time."], ["/documents", "Source documents", "Manage the documents you choose to use."], ...(user?.evidence_vault ? [["/documents/evidence", "Evidence", "Review the sources behind your claims."]] : []), ["/documents/stories", "My stories", "Save truthful examples from your experience."], ["/linkedin", "Professional profiles", "Review suggestions before changing a public profile."]] },
    { title: "My search", items: [["/jobs/profile", "Search preferences", "Resume, roles, locations and work mode."], ["/jobs/outreach?network=1", "Contacts & outreach", "Keep your contacts and reviewed drafts together."], ["/offers", "Offers & decisions", "Compare the offer details you record."], ["/jobs/weekly", "Weekly progress", "Review your recorded activity and choose targets."]] },
    { title: "Privacy & account", items: [["/settings", "Settings & privacy", "Sessions, permissions, export and account deletion."], ["/billing", "Credits & usage", "Review your plan, costs and purchase history."], ["/tools", "All tools", "Search the full catalogue when you need a specialist tool."]] },
  ];
  return <div className="workspace-page"><header className="workspace-heading"><div><h1>My Career</h1><p className="workspace-description">Your resume, experience and search preferences in one place. Choose what to add or edit.</p></div></header>
    {user && <CareerIdentity key={user.id} userId={user.id} />}
    {groups.map((g) => <section key={g.title} aria-label={g.title}><h2 className="font-semibold">{g.title}</h2><Reveal as="ul" stagger className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{g.items.map(([to, title, detail]) => <li key={to}><Link to={to!} className={link}><span className="font-semibold">{title}</span><span className="mt-2 block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{detail}</span></Link></li>)}</Reveal></section>)}
  </div>;
}
