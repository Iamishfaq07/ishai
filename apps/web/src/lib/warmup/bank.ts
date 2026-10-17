// The Interview Warm-up's questions (pages/Warmup.tsx): a fixed bank by track, written for Indian campus and early-
// career interviews first, with `tracksFor` rewording the few that only make sense in India for everyone else. No AI: each question's `kind` picks the checks its answer gets (checks.ts), and `tip` is what an
// interviewer is listening for. Bundled with the page only (a lazy chunk).

/** What kind of answer a question wants, which decides how it's checked. */
export type QuestionKind =
  | "intro" // "Tell me about yourself": now, before, why this job
  | "story" // "Tell me about a time…": situation, task, action, result
  | "motivation" // "Why this company / role?": a clear answer and a reason
  | "knowledge" // explain a concept: plainly, with an example
  | "situational" // "What would you do if…": steps, in order, owned
  | "reflection" // a weakness, a gap, a failure: honest, and what you're doing about it
  | "case" // a guesstimate or business case: assumptions, steps, numbers
  | "closing"; // "Any questions for us?", five-year plans: short and specific

export interface WarmupQuestion {
  id: string;
  text: string;
  kind: QuestionKind;
  /** What the interviewer listens for, in a line. */
  tip: string;
  /** Words for a good spoken length, when it differs from the kind's (a 30-second intro). */
  words?: [number, number];
}

export type TrackId = "campus_hr" | "intro" | "sde" | "data" | "support" | "sales" | "mba";
/** A company's or a role's questions from the question bank (pages/bank: "Warm up free on these questions"). */
export type BankTrackId = `company:${string}` | `role:${string}`;

export interface Track {
  id: TrackId | BankTrackId;
  name: string;
  /** Who it's for, in a line. */
  blurb: string;
  questions: WarmupQuestion[];
}

const q = (id: string, kind: QuestionKind, text: string, tip: string, words?: [number, number]): WarmupQuestion =>
  words ? { id, kind, text, tip, words } : { id, kind, text, tip };

const TMAY_TIP = "Who you are now, one or two things you've done (with a result), and why this job. About a minute.";

/** One of the warm-up's own tracks (the picker's). */
export interface FixedTrack extends Track {
  id: TrackId;
}

export const TRACKS: FixedTrack[] = [
  {
    id: "campus_hr",
    name: "Campus HR round",
    blurb: "The HR round at TCS, Infosys, Wipro, Accenture and most service companies.",
    questions: [
      q("hr-tmay", "intro", "Tell me about yourself.", TMAY_TIP),
      q("hr-why-us", "motivation", "Why do you want to join our company?", "Name something real about the company (its training, clients or work) and link it to you."),
      q("hr-hire", "motivation", "Why should we hire you?", "Two strengths with proof, matched to the role, then what you'll bring from day one."),
      q("hr-strength", "story", "What is your greatest strength? Give an example.", "One strength, proved with a short story, not a list of adjectives."),
      q("hr-weakness", "reflection", "What is your biggest weakness?", "A real one that won't sink the job, and what you're doing about it."),
      q("hr-relocate", "motivation", "Are you willing to relocate to any city in India?", "A clear yes or no, then one reason. If you have a limit, say it politely."),
      q("hr-shifts", "motivation", "Are you comfortable working night shifts or rotational shifts?", "Answer plainly, and show you've thought about what it means for you."),
      q("hr-5yrs", "closing", "Where do you see yourself in five years?", "Growth in this kind of work and the skills you'll build. Not 'abroad for an MS'."),
      q("hr-team", "story", "Tell me about a time you worked in a team.", "Your part in it, a problem the team hit, and how it ended."),
      q("hr-project", "story", "Tell me about a challenge in your final-year project.", "What went wrong, what you did about it, and what you got in the end."),
      q("hr-fail", "reflection", "Tell me about a time you failed. What did you learn?", "Own it, keep it short, and spend most of the answer on what changed after."),
      q("hr-lead", "story", "Tell me about a time you led something: a fest, a club or a project.", "How many people, what you decided, and what came of it."),
      q("hr-disagree", "situational", "What would you do if you disagreed with your team lead?", "Listen first, raise it privately with reasons, then go with the decision."),
      q("hr-deadline", "situational", "How would you handle a deadline you know you can't meet?", "Say it early, offer what you can deliver, and agree a new plan."),
      q("hr-degree", "motivation", "Why did you choose your degree?", "An honest reason and what you've done with it since."),
      q("hr-gap", "reflection", "Is there a gap in your education, or a backlog? How do you explain it?", "State it plainly, what you did meanwhile, and that it's behind you."),
      q("hr-know-us", "motivation", "What do you know about our company?", "What it does, its size, one recent piece of news, and why that matters to you."),
      q("hr-questions", "closing", "Do you have any questions for us?", "Ask one or two about training, the team or what good work looks like. Not salary first."),
      q("hr-bond", "motivation", "Are you okay with the service agreement or bond?", "Show you've read it and you're committed; ask about anything that's unclear."),
      q("hr-salary", "closing", "What are your salary expectations?", "For campus roles the package is set: say you're happy with the standard fresher offer."),
      q("hr-intern", "story", "Tell me about your internship. What did you do there?", "The team, your task, what you built or changed, and one number if you have it."),
      q("hr-pressure", "story", "How do you handle pressure? Give an example.", "A real deadline or exam, what you did, and how it turned out."),
    ],
  },
  {
    id: "intro",
    name: "Tell me about yourself",
    blurb: "The first question in almost every interview, and the ones like it.",
    questions: [
      q("in-tmay", "intro", "Tell me about yourself.", TMAY_TIP),
      q("in-30s", "intro", "Introduce yourself in 30 seconds.", "Three lines: who you are now, your best proof, what you want next.", [50, 95]),
      q("in-resume", "intro", "Walk me through your resume.", "In order, the highlights only, and a line on why each step led to the next."),
      q("in-not-resume", "story", "Tell me something about yourself that isn't on your resume.", "A real story that shows a trait the job needs."),
      q("in-friends", "story", "How would your friends describe you?", "Two or three words, each with a small example."),
      q("in-proud", "story", "What are you most proud of so far?", "One thing, why it was hard, and what it led to."),
      q("in-motivates", "motivation", "What motivates you?", "Be specific: the kind of problem or result that keeps you going, and an example."),
      q("in-field", "motivation", "Why did you choose your field of study?", "An honest reason, and what you've done with it since."),
      q("in-free", "closing", "What do you do in your free time?", "One or two real interests, briefly. Something you do, not only watch."),
      q("in-3words", "story", "Describe yourself in three words.", "Three words, each backed by a one-line example."),
      q("in-project", "knowledge", "Explain your final-year project in simple words.", "The problem, what you built, and one result. A friend outside your field should follow it."),
      q("in-different", "motivation", "What makes you different from the other candidates?", "One mix of skills or experience that's yours, with proof."),
      q("in-learnt", "story", "What have you learnt in the last six months?", "One skill, how you learnt it, and where you've used it."),
      q("in-change", "motivation", "Why are you looking for a change?", "What you want to grow into, not what you're running from."),
      q("in-current", "intro", "Tell me about your current role.", "The team, what you own, one thing you've improved, and what you want next."),
      q("in-achievement", "story", "Tell me about one achievement you'd like us to know about.", "The goal, what you did, and the result in a number."),
      q("in-keep-learning", "story", "How do you keep learning outside college or work?", "What you learn from, how often, and something you made with it."),
      q("in-role-model", "motivation", "Who is your role model, and why?", "One person, one quality, and how you try to practise it."),
      q("in-goal", "story", "Tell me about a goal you set and reached.", "The goal, the plan, the hard part, and the result."),
      q("in-customer", "intro", "Introduce yourself as if I were a customer you'll be helping.", "Warm, clear and short: who you are and how you'll help.", [50, 120]),
    ],
  },
  {
    id: "sde",
    name: "Software engineer",
    blurb: "SDE and developer interviews: projects, CS basics and how you work.",
    questions: [
      q("sde-tmay", "intro", "Tell me about yourself and the projects you've built.", "Your stack, your best project and its result, and what you want to build next."),
      q("sde-bug", "story", "Walk me through the hardest bug you've fixed.", "The symptom, how you narrowed it down, the fix, and what you changed so it doesn't recur."),
      q("sde-thread", "knowledge", "What is the difference between a process and a thread?", "Memory, cost to create and switch, and an example of when you'd use each."),
      q("sde-url", "knowledge", "What happens when you type a URL into the browser and press Enter?", "DNS, the connection and TLS, the request, the response, and rendering, in order."),
      q("sde-oop", "knowledge", "What are the four pillars of object-oriented programming? Give an example of one.", "Name all four, then one concrete example from code you've written."),
      q("sde-joins", "knowledge", "Explain SQL joins. When would you use a LEFT JOIN?", "Inner vs left in a sentence each, with a small two-table example."),
      q("sde-array-list", "knowledge", "What is the difference between an array and a linked list?", "Access, insertion and memory, and when you'd pick each."),
      q("sde-api", "knowledge", "What is an API? Explain REST to someone who isn't technical.", "An everyday comparison, then what a request and a response are."),
      q("sde-git", "knowledge", "How does Git help a team? What is a merge conflict?", "Branches and history, then a conflict and how you resolve it."),
      q("sde-bigo", "knowledge", "What is time complexity? What's the complexity of binary search, and why?", "What it measures, then log n because each step halves what's left."),
      q("sde-proud", "story", "Tell me about a project you're proud of. What was your part?", "Say 'I' for your part: what you built, the hard choice, and the result."),
      q("sde-prod", "situational", "Your code works on your machine but fails in production. What do you do?", "Logs and the error first, compare environments, reproduce, fix, then add a check."),
      q("sde-shortener", "case", "How would you design a URL shortener, at a high level?", "The API, how short codes are made, storage, redirects, and what happens at scale."),
      q("sde-normal", "knowledge", "What is normalisation in databases?", "Why duplicate data causes trouble, the first normal forms, and a small example."),
      q("sde-https", "knowledge", "What is the difference between HTTP and HTTPS?", "Encryption, certificates, and why it matters on a login page."),
      q("sde-learn-fast", "story", "Tell me about a time you learnt a new technology quickly.", "Why you needed it, how you learnt it, and what you shipped with it."),
      q("sde-review", "situational", "A teammate's pull request has problems. How do you review it?", "Read it fully, comment on the code not the person, suggest fixes, approve when it's right."),
      q("sde-stack-queue", "knowledge", "What is the difference between a stack and a queue? Where is each used?", "LIFO vs FIFO, and one real use of each (undo, a print queue)."),
      q("sde-cache", "knowledge", "What is caching, and why does it help?", "Keeping a copy closer, the speed it buys, and the risk of stale data."),
      q("sde-why", "motivation", "Why do you want to be a software engineer?", "A real moment that hooked you, and what you've built since."),
      q("sde-test-login", "situational", "How would you test a login page?", "Right and wrong passwords, empty fields, limits, security, and on a phone."),
      q("sde-feedback", "story", "Tell me about a time you got feedback on your code.", "What the feedback was, what you changed, and what you do differently now."),
    ],
  },
  {
    id: "data",
    name: "Data analyst",
    blurb: "Analyst roles: SQL, Excel, statistics and telling a story with data.",
    questions: [
      q("da-tmay", "intro", "Tell me about yourself and your work with data.", "Your tools, one analysis that changed something, and why this role."),
      q("da-where-having", "knowledge", "What is the difference between WHERE and HAVING in SQL?", "Rows before grouping vs groups after, with a small example."),
      q("da-decision", "story", "Tell me about an analysis that changed a decision.", "The question, the data, what you found, and what was decided."),
      q("da-missing", "knowledge", "How do you handle missing values in a dataset?", "Find out why they're missing first, then drop, fill or flag, with an example."),
      q("da-median", "knowledge", "Explain mean, median and mode. When is the median better?", "Each in a line, then salaries: a few high values pull the mean up."),
      q("da-sales-drop", "situational", "Sales dropped 20% last month. How would you find out why?", "Check the data first, then split by region, product and channel, and compare."),
      q("da-pivot", "knowledge", "What is a pivot table, and when do you use one?", "Summarising rows by groups, with a sales-by-region example."),
      q("da-causation", "knowledge", "What is the difference between correlation and causation? Give an example.", "Two things moving together vs one causing the other, with an everyday example."),
      q("da-dashboard", "story", "Describe a dashboard you built. Who used it?", "Who it was for, the three numbers that mattered, and what they did with it."),
      q("da-vlookup", "knowledge", "What does VLOOKUP do, and what would you use instead?", "Looking up a value by key, its limits, and XLOOKUP or INDEX-MATCH."),
      q("da-messy", "situational", "A manager needs a number by tomorrow, but the data is messy. What do you do?", "Agree what 'good enough' means, clean what matters, and state your caveats."),
      q("da-ab", "knowledge", "Explain an A/B test to someone who isn't technical.", "Two versions, random groups, one measure, and enough people to trust it."),
      q("da-outliers", "knowledge", "What are outliers, and how do you treat them?", "How you spot them, why they happen, and when you keep or remove them."),
      q("da-error", "story", "Tell me about a time you found an error in data.", "How you noticed, what it was, what you fixed, and who you told."),
      q("da-keys", "knowledge", "What is the difference between a primary key and a foreign key?", "Unique row id vs a link to another table, with an orders-customers example."),
      q("da-feature", "case", "How would you measure the success of a new feature in an app?", "The goal, two or three metrics, a baseline, and how long you'd watch."),
      q("da-why", "motivation", "Why data analytics?", "What you enjoy about finding answers in data, with an example."),
      q("da-chart", "knowledge", "Which chart would you use to show sales across months, and why?", "A line chart for change over time, and what you'd label."),
      q("da-explain", "story", "Tell me about a time you explained data to someone non-technical.", "Who, what they needed, how you made it simple, and what they did next."),
      q("da-window", "knowledge", "What is a window function in SQL? Give a use.", "A calculation across related rows without grouping them away: a running total or a rank."),
      q("da-tools", "closing", "Which tools do you use, and which do you want to learn next?", "Your main tools honestly, and one you're learning, with why."),
    ],
  },
  {
    id: "support",
    name: "Customer support / BPO",
    blurb: "Voice and non-voice support, BPO and customer success roles.",
    questions: [
      q("cs-tmay", "intro", "Tell me about yourself.", TMAY_TIP),
      q("cs-shouting", "situational", "A customer is shouting at you on a call. What do you do?", "Stay calm, let them finish, say sorry for the trouble, and fix what you can."),
      q("cs-refund", "situational", "A customer wants a refund that's against the policy. How do you say no?", "Show you understand, explain the rule simply, and offer what you can do."),
      q("cs-why", "motivation", "Why do you want to work in customer support?", "You like solving people's problems: show it with an example."),
      q("cs-shifts", "motivation", "Are you comfortable with night shifts and weekend shifts?", "Answer clearly and show you've planned for it."),
      q("cs-helped", "story", "Tell me about a time you helped someone solve a problem.", "The problem, what you did step by step, and how they felt after."),
      q("cs-dont-know", "situational", "A customer asks something you don't know. What do you say?", "Be honest, find out (or escalate), and get back when you said you would."),
      q("cs-multi", "situational", "How do you handle many chats or calls at once?", "Prioritise, use templates wisely, and never leave anyone waiting silently."),
      q("cs-calm", "story", "Tell me about a time you stayed calm under pressure.", "The pressure, what you did, and the result."),
      q("cs-good", "knowledge", "What does good customer service mean to you?", "Quick, kind and correct, with an example of when you got it."),
      q("cs-third-call", "situational", "A customer calls for the third time about the same issue. What do you do?", "Own it this time: read the history, fix the root cause, and follow up."),
      q("cs-process", "motivation", "What do you know about voice and non-voice processes?", "The difference, which suits you, and why."),
      q("cs-beyond", "story", "Tell me about a time you went beyond what was asked.", "What was expected, what you did extra, and why it mattered."),
      q("cs-elderly", "situational", "How would you explain a technical problem to an elderly customer?", "Slow, simple words, one step at a time, and check they're with you."),
      q("cs-low-score", "reflection", "What would you do if your call-quality score was low?", "Listen to your calls, ask for feedback, and practise the weak part."),
      q("cs-tat", "knowledge", "What is TAT, and why does it matter?", "Turnaround time: how fast an issue is solved, and why customers feel it."),
      q("cs-break-rule", "situational", "A friendly customer asks you to break a rule 'just once'. What do you say?", "Kind but firm, explain why, and offer what you can do."),
      q("cs-2yrs", "closing", "Where do you see yourself in two years?", "Growing in this work: a senior or quality role, and the skills you'll build."),
      q("cs-repetitive", "reflection", "How do you deal with repetitive work?", "Honestly, and how you keep quality and focus up."),
      q("cs-english", "intro", "Tell me about your day yesterday, in a few sentences.", "Clear, simple English at an easy pace. They're listening to how you speak.", [60, 140]),
    ],
  },
  {
    id: "sales",
    name: "Sales",
    blurb: "Sales, business development and inside-sales roles.",
    questions: [
      q("sa-tmay", "intro", "Tell me about yourself.", TMAY_TIP),
      q("sa-pen", "situational", "Sell me this pen.", "Ask what they need first, then sell the benefit that fits, then ask for the sale."),
      q("sa-why", "motivation", "Why do you want to work in sales?", "You like people and targets: show it with something you've sold or organised."),
      q("sa-convince", "story", "Tell me about a time you convinced someone to change their mind.", "Their view, how you listened, your case, and what they decided."),
      q("sa-expensive", "situational", "A customer says your product is too expensive. What do you say?", "Agree it's an investment, show the value, and compare like with like."),
      q("sa-target", "story", "Tell me about a target you hit, or one you missed.", "The number, what you did, the result, and what you learnt."),
      q("sa-new-city", "situational", "How would you find new customers in a city you don't know?", "Research, local networks and referrals, a daily plan, and tracking."),
      q("sa-rejection", "reflection", "How do you handle rejection?", "Honestly, how you bounce back, and what you take from a 'no'."),
      q("sa-ghosted", "situational", "A client stops replying after a good meeting. What's your next step?", "A polite follow-up with something useful, a different channel, then a clear close."),
      q("sa-lead", "knowledge", "What is the difference between a lead and a prospect?", "Interest vs a qualified fit, with an example."),
      q("sa-negotiation", "story", "Tell me about your best negotiation.", "What each side wanted, how you found the middle, and the deal."),
      q("sa-first-month", "case", "How would you plan your first month in this role?", "Learn the product, meet the team and clients, set targets, and review."),
      q("sa-field", "motivation", "Are you comfortable with field work and travel?", "A clear answer and how you'd make it work."),
      q("sa-competitor", "situational", "A customer says a competitor is cheaper. How do you respond?", "Don't attack them: compare value, service and what's included."),
      q("sa-pitch", "knowledge", "What makes a good sales pitch?", "About the customer, short, one clear benefit, and a next step."),
      q("sa-relationship", "story", "Tell me about a time you built a relationship with someone difficult.", "Why it was hard, what you did, and where it got to."),
      q("sa-kirana", "situational", "How would you sell our product to a small shop owner?", "Their day and their worries, a simple benefit, a small first order."),
      q("sa-motivation", "reflection", "How do you keep yourself going in a slow month?", "Routine, small wins, and asking for help."),
      q("sa-quarter", "closing", "What targets would you set for yourself in the first quarter?", "Realistic numbers you'd track: calls, meetings, deals."),
      q("sa-experience", "motivation", "Why should we pick you over someone with more experience?", "Energy, how fast you learn, and proof you can sell."),
    ],
  },
  {
    id: "mba",
    name: "MBA / management",
    blurb: "Management trainee, consulting, product and MBA placement interviews.",
    questions: [
      q("mba-profile", "intro", "Walk me through your profile.", "Education, work or internships, the thread that connects them, and why this role."),
      q("mba-why-role", "motivation", "Why this role after your MBA?", "What you want to learn and own, and how your past fits it."),
      q("mba-lead", "story", "Tell me about a time you led a team without formal authority.", "The goal, how you got people on board, and the result."),
      q("mba-chai", "case", "How would you grow sales for a chai brand in a new city?", "Who buys, where, at what price, and two or three moves with numbers."),
      q("mba-two-wheelers", "case", "Estimate how many two-wheelers are sold in Bengaluru in a year.", "Say your assumptions, build it step by step, and sanity-check the number."),
      q("mba-incomplete", "story", "Tell me about a decision you made with incomplete data.", "What you knew, what you assumed, what you decided, and how it went."),
      q("mba-mkt-sales", "knowledge", "What is the difference between marketing and sales?", "Creating demand vs closing it, with an example."),
      q("mba-share", "case", "Our product's market share fell. How would you approach it?", "Check the numbers, split by segment, compare competitors, then fix the cause."),
      q("mba-conflict", "story", "Describe a conflict in a team project and how you handled it.", "What it was about, what you did, and how it ended."),
      q("mba-mt", "motivation", "Why should we hire you as a management trainee?", "Two strengths with proof, and why this company's programme."),
      q("mba-balance", "knowledge", "Explain a company's balance sheet in simple words.", "What it owns, what it owes, and the difference, with a small example."),
      q("mba-weakness", "reflection", "What's one weakness, and how are you working on it?", "A real one, and the steps you're taking."),
      q("mba-ott", "case", "How would you price a new OTT subscription for India?", "Who it's for, what they pay now, price points, and a test plan."),
      q("mba-summer", "story", "Tell me about your summer internship and what changed because of it.", "The problem, your work, and the result in a number."),
      q("mba-news", "knowledge", "Tell me about a business news story you've followed, and your view on it.", "What happened, why it matters, and what you'd do."),
      q("mba-missed", "situational", "Your team misses its quarterly target. What do you do in the first week?", "Find why, talk to the team, fix one thing fast, and set a plan."),
      q("mba-tier2", "case", "Should a quick-commerce company enter tier-2 cities?", "Demand, costs, competition, and a recommendation with what you'd test first."),
      q("mba-risk", "story", "Tell me about a time you took a calculated risk.", "The options, why you chose, and what happened."),
      q("mba-5yrs", "closing", "Where do you see yourself in five years?", "A role you're growing toward here, and the skills it needs."),
      q("mba-competitors", "motivation", "Why this company over its competitors?", "Something specific about how it works, and why that suits you."),
    ],
  },
];

/** How many questions a warm-up round asks. */
export const ROUND = 5;

// Outside India: the tracks and questions that name India's own practices (campus placement rounds, service bonds,
// "any city in India", backlogs), reworded for anywhere; null drops a question that has no equivalent.
const TRACK_WORLDWIDE: Partial<Record<TrackId, Pick<Track, "name" | "blurb">>> = {
  campus_hr: { name: "Graduate HR round", blurb: "The first HR screen for graduate and entry-level roles at most large employers." },
  support: { name: "Customer support", blurb: "Voice and chat support, contact-centre and customer success roles." },
  mba: { name: "MBA / management", blurb: "Graduate schemes, consulting, product and MBA recruiting interviews." },
};
const QUESTION_WORLDWIDE: Record<string, Partial<Pick<WarmupQuestion, "text" | "tip">> | null> = {
  "hr-relocate": { text: "Are you willing to relocate for this role?" },
  "hr-5yrs": { tip: "Growth in this kind of work and the skills you'll build here." },
  "hr-lead": { text: "Tell me about a time you led something: an event, a club or a project." },
  "hr-gap": { text: "Is there a gap in your education or work history? How do you explain it?" },
  "hr-bond": null,
  "hr-shifts": { text: "Are you comfortable with the hours this role needs, including any evening or weekend work?" },
  "hr-salary": { tip: "For graduate roles the salary is often set: say you're happy with the standard offer, or give a researched range." },
  "hr-project": { text: "Tell me about a challenge in your final-year or capstone project." },
  "cs-shifts": { text: "Are you comfortable working evening and weekend shifts?" },
  "cs-process": { text: "What do you know about phone, chat and email support?" },
  "mba-chai": { text: "How would you grow sales for a coffee brand in a new city?" },
  "mba-two-wheelers": { text: "Estimate how many bicycles are sold in your city in a year." },
  "mba-ott": { text: "How would you price a new video-streaming subscription in a new country?" },
  "mba-tier2": { text: "Should a quick-commerce company expand into smaller cities?" },
};

/** The tracks for the country the user applies in: India's as written, everywhere else's reworded. */
export function tracksFor(country: string = "IN"): FixedTrack[] {
  if (country.toUpperCase() === "IN") return TRACKS;
  return TRACKS.map((t) => ({
    ...t,
    ...TRACK_WORLDWIDE[t.id],
    questions: t.questions.flatMap((x) => {
      const change = QUESTION_WORLDWIDE[x.id];
      if (change === null) return [];
      return [change ? { ...x, ...change } : x];
    }),
  }));
}

// The question bank's tracks opened in this page load (pages/bank/WarmupRoute.tsx adds one before the page shows).
const bankTracks = new Map<string, Track>();

/** Makes a question-bank track findable by `trackById` (the same questions everywhere: they aren't per country). */
export function addBankTrack(track: Track & { id: BankTrackId }): void {
  bankTracks.set(track.id, track);
}

export function trackById(id: string, country: string = "IN"): Track | undefined {
  return tracksFor(country).find((t) => t.id === id) ?? bankTracks.get(id);
}

/**
 * A round: the track's introduction first (where every interview starts), then the rest picked at random, mixing
 * kinds, skipping the questions just asked (`recent`) while there are others. `random` is for tests.
 */
export function pickRound(track: Track, recent: string[] = [], n: number = ROUND, random: () => number = Math.random): WarmupQuestion[] {
  const intro = track.questions.find((x) => x.kind === "intro");
  const pool = track.questions.filter((x) => x !== intro);
  const fresh = pool.filter((x) => !recent.includes(x.id));
  const from = fresh.length >= n - 1 ? fresh : pool;
  const shuffled = [...from].map((x) => ({ x, r: random() })).sort((a, b) => a.r - b.r).map(({ x }) => x);
  // One of each kind before any kind twice, so a round isn't four definitions in a row.
  const picked: WarmupQuestion[] = [];
  const kinds = new Set<QuestionKind>();
  for (const x of shuffled) {
    if (picked.length >= n - (intro ? 1 : 0)) break;
    if (!kinds.has(x.kind)) {
      picked.push(x);
      kinds.add(x.kind);
    }
  }
  for (const x of shuffled) {
    if (picked.length >= n - (intro ? 1 : 0)) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return intro ? [intro, ...picked] : picked;
}
