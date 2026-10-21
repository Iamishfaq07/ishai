/**
 * Group discussion practice: the GD round many Indian campus drives and MBA admissions use. A topic bank with points
 * on both sides (arguments, not statistics, so nothing here can be out of date), abstract topics with angles, and the
 * structure evaluators look for. Practice is timed and self-reviewed; nothing is recorded or sent.
 */

export interface Topic { id: string; title: string; kind: "current" | "business" | "abstract"; for: string[]; against: string[] }

export const TOPICS: Topic[] = [
  { id: "remote", title: "Remote work is better than working from the office", kind: "business",
    for: ["No commute: time and money back every day", "Companies can hire from anywhere, not one city", "Fewer interruptions for focused work"],
    against: ["Freshers learn faster sitting beside experienced people", "Collaboration and trust are easier in person", "Home is not a workspace for everyone"] },
  { id: "ai-jobs", title: "AI will create more jobs than it destroys", kind: "current",
    for: ["Every major technology so far created new kinds of work", "AI needs people to build, check, and apply it", "Cheaper services open new markets"],
    against: ["The new jobs need different skills from the lost ones", "Change may be faster than people can retrain", "Gains may go to a few companies"] },
  { id: "social", title: "Social media does more harm than good", kind: "current",
    for: ["Misinformation spreads faster than corrections", "Design rewards outrage and endless scrolling", "Comparison culture affects young people's wellbeing"],
    against: ["Small businesses and creators reach customers for free", "Gives a voice to people traditional media ignored", "Keeps families and communities connected"] },
  { id: "cashless", title: "A cashless economy is good for India", kind: "current",
    for: ["UPI made small payments instant and nearly free", "Digital trails make tax evasion harder", "Less cash handling and fewer counterfeit notes"],
    against: ["Not everyone has a smartphone, data, or digital literacy", "Fraud and scams move online", "Outages leave people unable to pay"] },
  { id: "coding", title: "Coding should be compulsory in schools", kind: "current",
    for: ["Teaches logical, step-by-step problem solving", "Software touches every career now", "Early exposure helps children find an interest"],
    against: ["Basics like reading and maths still need more time", "Many schools lack trained teachers and computers", "Compulsion can turn curiosity into a chore"] },
  { id: "ev", title: "Electric vehicles are the future of Indian transport", kind: "business",
    for: ["Cleaner city air where vehicles are used", "Lower running costs per kilometre", "Two- and three-wheelers suit EVs well"],
    against: ["Charging networks are still thin outside big cities", "Clean only if the electricity is clean", "Battery cost, raw materials, and recycling"] },
  { id: "hustle", title: "Hustle culture is necessary to succeed", kind: "business",
    for: ["Early-career effort compounds into skills and reputation", "Start-ups often need intense bursts", "Ambition drives many achievements"],
    against: ["Burnout lowers output and quality", "Long hours aren't the same as results", "Health and relationships pay the price"] },
  { id: "startup", title: "Freshers should join a start-up rather than a large company", kind: "business",
    for: ["Wider responsibility and faster learning", "Closer to decisions and founders", "Ownership and visible impact"],
    against: ["Structured training and mentoring at large firms", "More job security and stable pay", "A known brand helps the next job search"] },
  { id: "online-ed", title: "Online education can replace classrooms", kind: "current",
    for: ["The best teachers can reach anyone, anywhere", "Learn at your own pace and repeat lessons", "Cheaper for many learners"],
    against: ["Completion rates are often low without structure", "Labs, sport, and peer learning need presence", "Unequal access to devices and quiet space"] },
  { id: "four-day", title: "India should move to a four-day work week", kind: "business",
    for: ["Rested people can be more productive per hour", "Helps attract and keep talent", "Less commuting and office cost"],
    against: ["Many services must run every day", "Longer days may cancel the benefit", "Hard for small businesses and manufacturing"] },
  { id: "gig", title: "The gig economy offers freedom, not insecurity", kind: "business",
    for: ["Choose when and how much to work", "Easy entry for people without degrees", "Extra income alongside study or another job"],
    against: ["No paid leave, health cover, or pension by default", "Income swings with platform decisions", "Little bargaining power for workers"] },
  { id: "degree", title: "A college degree is no longer necessary for a good career", kind: "current",
    for: ["Many employers now hire on skills and portfolios", "Online courses and apprenticeships teach job skills", "Avoids debt and years of cost"],
    against: ["Many roles and countries still require degrees", "College builds networks and broad thinking", "Degrees still filter early-career hiring"] },
  { id: "privacy", title: "Privacy matters more than security in the digital age", kind: "current",
    for: ["Data collected for safety can be misused", "Privacy protects free speech and dissent", "Breaches expose people when data is hoarded"],
    against: ["Some monitoring stops fraud and crime", "Security protects the vulnerable", "Clear rules can balance both"] },
  { id: "brain-drain", title: "Brain drain is a serious problem for India", kind: "current",
    for: ["Public money trains talent that works abroad", "Research and start-ups lose leaders", "Weakens institutions over time"],
    against: ["Remittances support families and the economy", "Diaspora brings investment, links, and returnees", "Global exposure flows back as skills"] },
  { id: "moonlighting", title: "Moonlighting is ethical", kind: "business",
    for: ["Employees own their time outside work hours", "Side work builds skills and income", "Many careers need more than one job"],
    against: ["Conflicts of interest with the employer", "Tiredness can hurt the main job", "Contracts and trust may forbid it"] },
  { id: "zero", title: "Zero", kind: "abstract",
    for: ["Zero as a beginning: start-ups and fresh starts", "India's contribution to mathematics", "Zero waste, zero emissions, zero tolerance"],
    against: ["Zero as nothing: emptiness or a dead end", "Zero-sum thinking versus win-win", "The value of nothing: rest and silence"] },
  { id: "red", title: "Red", kind: "abstract",
    for: ["Danger and stop signs: caution", "Passion, energy, and courage", "Red tape and bureaucracy"],
    against: ["In the red: losses and debt", "Celebration: festivals and weddings", "Different meanings across cultures"] },
  { id: "glass", title: "The glass is half full", kind: "abstract",
    for: ["Optimism drives action and resilience", "Framing changes decisions", "Leaders need to show hope"],
    against: ["Realism avoids nasty surprises", "Half empty means room to grow", "Engineers say the glass is twice as big as needed"] },
];

export const STRUCTURE = [
  { title: "Open (if you start)", text: "Define the topic or frame it in one line, then give the group two or three angles to discuss." },
  { title: "Enter", text: "Build on the last speaker: “Adding to Priya's point…” or offer a contrast: “There's another side…”." },
  { title: "Add value", text: "One point at a time, with a reason and an example. Quality over airtime." },
  { title: "Include others", text: "Bring in someone who hasn't spoken. Evaluators score teamwork, not just content." },
  { title: "Close", text: "Summarise both sides fairly and say where the group landed, without new points." },
];

export const REVIEW = [
  "I spoke at least two or three times",
  "Each point had a reason or an example",
  "I built on someone else's point",
  "I didn't interrupt or raise my voice",
  "I brought someone else in",
  "I could summarise both sides at the end",
];

export const PREP_SECONDS = 120;
export const TALK_SECONDS = 300;

/** A random topic, not the one just shown. */
export function pickTopic(kind: Topic["kind"] | "any", not: string | null, rand = Math.random): Topic {
  const pool = TOPICS.filter((t) => (kind === "any" || t.kind === kind) && t.id !== not);
  return pool[Math.floor(rand() * pool.length)] ?? TOPICS[0]!;
}
