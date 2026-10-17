/**
 * The examples and the few words that change with the country someone applies in (region.ts): the cities, employers,
 * names and schools placeholders and samples use, how a grade is written, what an entry-level candidate and a first
 * screening call are called, and where to report a job scam. India keeps its own text exactly as it was written; the
 * countries we know best get their own; everyone else gets neutral international English. One place for all of it,
 * so pages don't each carry their own ternaries (regionCopy.test.ts).
 */
import { currencyFor, isIndia } from "./region";

const upper = (code: string | null | undefined) => (code ?? "").toUpperCase();

/** A big city there, for an example job (India's tech capital first). */
export const SAMPLE_CITY: Record<string, string> = {
  IN: "Bengaluru", US: "Austin", GB: "London", CA: "Toronto", AU: "Sydney", DE: "Berlin", IE: "Dublin", NL: "Amsterdam",
  AE: "Dubai", SG: "Singapore", FR: "Paris", NZ: "Auckland", ZA: "Cape Town", PH: "Manila", PK: "Lahore", NG: "Lagos",
};

/** The example city for the country, or null when there isn't one (say "remote" or "your city" instead). */
export function sampleCity(code: string | null | undefined): string | null {
  return SAMPLE_CITY[upper(code)] ?? null;
}

/** Placeholders and examples, as people there would write them. */
export interface RegionExamples {
  /** A second city, for "Another city, e.g. …" (null: no example). */
  otherCity: string | null;
  /** An employer and a job title, for "Add a job". */
  company: string;
  jobTitle: string;
  /** Another employer, a person's name and the extra details, for outreach messages. */
  outreachCompany: string;
  person: string;
  referral: string;
  coldEmail: string;
  followUp: string;
  /** A school and a degree, for the resume editor's education. */
  school: string;
  degree: string;
}

const EXAMPLES: Record<string, RegionExamples> = {
  IN: {
    otherCity: "Indore", company: "Infosys", jobTitle: "Systems Engineer", outreachCompany: "Flipkart",
    person: "Priya Sharma", referral: "We were batchmates at NIT Trichy", coldEmail: "Serving notice, can join in 30 days",
    followUp: "Applied on 2 October through Naukri", school: "IIT Delhi, or Delhi Public School (CBSE)",
    degree: "B.Tech, or Class 12 (PCM)",
  },
  US: {
    otherCity: "Denver", company: "Target", jobTitle: "Software Engineer", outreachCompany: "Stripe",
    person: "Sarah Johnson", referral: "We were classmates at UT Austin", coldEmail: "Can start two weeks after an offer",
    followUp: "Applied on October 2 through LinkedIn", school: "University of Texas at Austin", degree: "B.S. or B.A.",
  },
  CA: {
    otherCity: "Calgary", company: "Shopify", jobTitle: "Software Developer", outreachCompany: "RBC",
    person: "Emily Tremblay", referral: "We were classmates at U of T", coldEmail: "Two weeks' notice, can start in March",
    followUp: "Applied on October 2 through LinkedIn", school: "University of Toronto", degree: "BSc or BA",
  },
  GB: {
    otherCity: "Leeds", company: "Barclays", jobTitle: "Graduate Software Engineer", outreachCompany: "Monzo",
    person: "Emma Clarke", referral: "We were on the same course at Manchester",
    coldEmail: "One month's notice, can start in March", followUp: "Applied on 2 October through LinkedIn",
    school: "University of Manchester", degree: "BSc or BA",
  },
  IE: {
    otherCity: "Cork", company: "Accenture", jobTitle: "Graduate Software Engineer", outreachCompany: "Intercom",
    person: "Aoife Murphy", referral: "We were in the same class at Trinity",
    coldEmail: "One month's notice, can start in March", followUp: "Applied on 2 October through LinkedIn",
    school: "Trinity College Dublin", degree: "BSc or BA",
  },
  AU: {
    otherCity: "Brisbane", company: "Atlassian", jobTitle: "Graduate Software Engineer", outreachCompany: "Canva",
    person: "Olivia Smith", referral: "We studied together at the University of Melbourne",
    coldEmail: "Four weeks' notice, can start in March", followUp: "Applied on 2 October through SEEK",
    school: "University of Melbourne", degree: "Bachelor of Science",
  },
  DE: {
    otherCity: "Hamburg", company: "SAP", jobTitle: "Software Engineer", outreachCompany: "Zalando",
    person: "Anna Schmidt", referral: "We studied together at TU München",
    coldEmail: "Three months' notice, can start in April", followUp: "Applied on 2 October through LinkedIn",
    school: "TU München", degree: "B.Sc. or M.Sc.",
  },
};
const WORLD_EXAMPLES: RegionExamples = {
  otherCity: null, company: "Unilever", jobTitle: "Software Engineer", outreachCompany: "Deloitte",
  person: "Alex Morgan", referral: "We studied at the same university", coldEmail: "Available to start in a month",
  followUp: "Applied on 2 October through LinkedIn", school: "Your university or college", degree: "Bachelor's or Master's",
};

export function regionExamples(code: string | null | undefined): RegionExamples {
  return EXAMPLES[upper(code)] ?? WORLD_EXAMPLES;
}

/** How a grade is written on a resume there: the field's label, its hint and an example. */
export interface GradeCopy {
  label: string;
  hint: string;
  placeholder: string;
  /** The word in a sentence ("education first with your CGPA"). */
  word: string;
}

const GPA_4: GradeCopy = { label: "GPA (optional)", hint: "With the scale, as on your transcript.", placeholder: "3.7 / 4.0 GPA", word: "GPA" };
const CLASSIFICATION: GradeCopy = {
  label: "Grade (optional)", hint: "Your degree classification, or your predicted grade.", placeholder: "First, or 2:1", word: "grade",
};
const GRADES: Record<string, GradeCopy> = {
  IN: { label: "CGPA or percentage (optional)", hint: "As on your marksheet, with the scale.", placeholder: "8.6 / 10 CGPA, or 92%", word: "CGPA" },
  US: GPA_4,
  CA: GPA_4,
  GB: CLASSIFICATION,
  IE: CLASSIFICATION,
  AU: { ...GPA_4, placeholder: "6.2 / 7 GPA" },
  NZ: { ...GPA_4, placeholder: "7.5 / 9 GPA" },
  DE: { label: "Grade (optional)", hint: "Your final grade, as on your certificate.", placeholder: "1.7", word: "grade" },
};
const WORLD_GRADE: GradeCopy = { ...GPA_4, label: "GPA or grade (optional)" };

export function gradeCopy(code: string | null | undefined): GradeCopy {
  return GRADES[upper(code)] ?? WORLD_GRADE;
}

/** The words that differ between India and everywhere else. */
export interface RegionWords {
  /** The job level for students and recent graduates ("Fresher" / "Entry level"). */
  entryLevel: string;
  /** The same as a word the job search understands, toggled by a chip (both read as that level). */
  entryLevelQuery: string;
  /** The group those chips sit in ("For freshers" / "Early career"). */
  earlyCareer: string;
  /** A student or recent graduate, as a choice ("Student / fresher" / "Student / new grad"), as a level
   *  ("Fresher" / "Student / new grad") and in a sentence ("Fresher or student" / "Student or new graduate"). */
  student: string;
  studentLevel: string;
  studentOrGraduate: string;
  /** The Campus resume template's name ("Campus" / "Graduate"). */
  campusTemplate: string;
  /** The first screening call ("HR round" / "recruiter screen"). */
  screen: string;
  /** The outreach email sent with a resume ("Email to HR" / "Email to a recruiter"), and several of them. */
  coldEmail: string;
  coldEmails: string;
}

const INDIA_WORDS: RegionWords = {
  entryLevel: "Fresher", entryLevelQuery: "fresher", earlyCareer: "For freshers",
  student: "Student / fresher", studentLevel: "Fresher", studentOrGraduate: "Fresher or student",
  campusTemplate: "Campus", screen: "HR round", coldEmail: "Email to HR", coldEmails: "emails to HR",
};
const WORLD_WORDS: RegionWords = {
  entryLevel: "Entry level", entryLevelQuery: "entry-level", earlyCareer: "Early career",
  student: "Student / new grad", studentLevel: "Student / new grad", studentOrGraduate: "Student or new graduate",
  campusTemplate: "Graduate", screen: "recruiter screen", coldEmail: "Email to a recruiter", coldEmails: "emails to recruiters",
};

export function regionWords(code: string | null | undefined): RegionWords {
  return isIndia(code) ? INDIA_WORDS : WORLD_WORDS;
}

/** The money sign people there write ("₹", "$", "£", "€"), from the country's currency. */
export function currencySymbol(code: string | null | undefined): string {
  const currency = currencyFor(code);
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Where to report a job scam that has already cost money or details: the national service, when there's one. */
export interface ScamReport {
  /** Where to report, linked: [label, url]. */
  links: Array<[string, string]>;
  /** A phone line, when there's one ("1930"). */
  phone: string | null;
  /** What the service is, in a few words ("the national cyber-crime helpline"). */
  about: string;
}

const SCAM_REPORT: Record<string, ScamReport> = {
  IN: { links: [["cybercrime.gov.in", "https://cybercrime.gov.in/"]], phone: "1930", about: "the national cyber-crime helpline" },
  US: {
    links: [["reportfraud.ftc.gov", "https://reportfraud.ftc.gov/"], ["ic3.gov", "https://www.ic3.gov/"]],
    phone: null,
    about: "the FTC and the FBI's Internet Crime Complaint Center",
  },
  GB: { links: [["actionfraud.police.uk", "https://www.actionfraud.police.uk/"]], phone: "0300 123 2040", about: "Action Fraud, the UK's fraud-reporting centre" },
};

/** The national place to report a scam, or null where we don't name one (then: the local police or consumer body). */
export function scamReport(code: string | null | undefined): ScamReport | null {
  return SCAM_REPORT[upper(code)] ?? null;
}

// Companies in the interview-style guides that hire almost only in India: suggested there, not elsewhere (they still
// match when typed). India's large IT-services firms hire worldwide, so outside India they come after the rest. Each
// guide says which it is (`market`, from the question bank); these lists cover a server that doesn't send it yet.
const INDIA_ONLY_COMPANIES = new Set(["flipkart", "razorpay", "swiggy", "zomato"]);
const INDIA_SERVICES = new Set(["tcs", "infosys", "wipro", "cognizant"]);

type Market = "india" | "india-first" | "global";
const marketOf = (s: { slug: string; market?: Market }): Market =>
  s.market ?? (INDIA_ONLY_COMPANIES.has(s.slug) ? "india" : INDIA_SERVICES.has(s.slug) ? "india-first" : "global");

/** The companies to suggest for interview practice, for the country: India's list as it is, elsewhere reordered. */
export function companiesFor<T extends { slug: string; market?: Market }>(styles: readonly T[], code: string | null | undefined): T[] {
  if (isIndia(code)) return [...styles];
  return [...styles.filter((s) => marketOf(s) === "global"), ...styles.filter((s) => marketOf(s) === "india-first")];
}
