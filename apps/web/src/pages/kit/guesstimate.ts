// Guesstimates: "How many … in a day?" questions from consulting, product and analyst interviews. Interviewers judge
// the reasoning more than the number, so the page walks the five steps candidates are coached on (clarify, break it
// down, state assumptions, calculate, sanity-check) and reviews them. The questions are practice prompts; "consider"
// lists angles to think about, never figures to copy. The AI review is POST /v1/practice/guesstimate-review.

export interface Question { id: string; text: string; kind: "consumer" | "business" | "infrastructure"; consider: string[] }

export const QUESTIONS: Question[] = [
  { id: "tea", kind: "consumer", text: "How many cups of tea are sold at stalls and cafes in Bengaluru in a day?",
    consider: ["who drinks tea outside home, by age or work", "cups per person per day", "stalls vs cafes vs offices"] },
  { id: "phones", kind: "consumer", text: "How many smartphones are sold in India in a year?",
    consider: ["people who own a smartphone", "how often they replace it", "first-time buyers"] },
  { id: "metro", kind: "infrastructure", text: "How many people ride the Delhi Metro on a weekday?",
    consider: ["people who commute daily", "share who use the metro", "round trips vs one-way"] },
  { id: "petrol", kind: "business", text: "How many petrol pumps are there in Mumbai?",
    consider: ["vehicles in the city", "how often each fills up", "vehicles one pump serves in a day"] },
  { id: "delivery", kind: "business", text: "How many food delivery orders are placed in Hyderabad on a Saturday?",
    consider: ["households that order online", "how often they order", "weekend vs weekday"] },
  { id: "haircut", kind: "business", text: "What is the yearly revenue of an average barber shop in Pune?",
    consider: ["chairs and hours open", "customers per chair per day", "price per visit and services mix"] },
  { id: "umbrella", kind: "consumer", text: "How many umbrellas are sold in Kerala in a year?",
    consider: ["households and people who use one", "how long one lasts", "the monsoon months"] },
  { id: "flights", kind: "infrastructure", text: "How many flights take off from Chennai airport in a day?",
    consider: ["runways and hours of operation", "minutes between take-offs at peak and off-peak", "domestic vs international"] },
  { id: "coaching", kind: "business", text: "What is the market size of engineering entrance coaching in India?",
    consider: ["students taking the exams each year", "share who join coaching", "average fee, online vs classroom"] },
  { id: "laptops", kind: "consumer", text: "How many laptops are used on a college campus of 5,000 students?",
    consider: ["students who own one", "faculty and staff", "shared lab machines"] },
];

export type StepId = "clarify" | "approach" | "assumptions" | "calculation" | "answer" | "sanity";

export interface Step { id: StepId; name: string; hint: string; rows: number }

export const STEPS: Step[] = [
  { id: "clarify", name: "Clarify", hint: "What exactly is being counted? The place, the time period, what's in and out. Write the questions you'd ask, and the answers you'll assume.", rows: 2 },
  { id: "approach", name: "Break it down", hint: "Pick a route: from the demand side (people × how often) or the supply side (outlets × capacity). Write it as a formula of a few parts.", rows: 3 },
  { id: "assumptions", name: "Assumptions", hint: "One line per number, each with a short reason. Round numbers make the maths easy and are fine.", rows: 4 },
  { id: "calculation", name: "Calculate", hint: "Multiply it through, one step per line, so a mistake is easy to spot.", rows: 3 },
  { id: "answer", name: "Answer", hint: "One number with its unit, rounded (\"about 60 lakh cups a day\").", rows: 1 },
  { id: "sanity", name: "Sanity check", hint: "Check it another way, or against something you know. Say what would change it most.", rows: 2 },
];

export interface StepCheck { id: StepId; ok: boolean; note: string }

const hasNumber = (s: string) => /\d/.test(s);

/** Instant checks: is each step there and shaped right? The AI review judges whether it's sensible. */
export function checkSteps(steps: Partial<Record<StepId, string>>): StepCheck[] {
  const get = (id: StepId) => (steps[id] ?? "").trim();
  const assumptionLines = get("assumptions").split("\n").filter((l) => l.trim());
  const calcLines = get("calculation").split("\n").filter((l) => l.trim());
  return [
    { id: "clarify", ok: get("clarify").length >= 15, note: get("clarify") ? "Scope set." : "Start by pinning down what's being counted, and for when." },
    { id: "approach", ok: /[x×*]|times|multipl/i.test(get("approach")) || get("approach").split(/[,;\n]/).length >= 3,
      note: "Write the route as parts that multiply, e.g. people × share who buy × times a day." },
    { id: "assumptions", ok: assumptionLines.length >= 3 && assumptionLines.every(hasNumber),
      note: assumptionLines.length < 3 ? "List at least three numbers, one per line." : assumptionLines.every(hasNumber) ? "Each line has a number." : "Give each assumption a number." },
    { id: "calculation", ok: calcLines.length >= 1 && hasNumber(get("calculation")) && /=/.test(get("calculation")),
      note: "Show the working with an = on each line." },
    { id: "answer", ok: hasNumber(get("answer")), note: "End on one number with its unit." },
    { id: "sanity", ok: get("sanity").length >= 20, note: get("sanity") ? "Checked." : "Check it another way before you finish: interviewers ask." },
  ];
}

export function pickQuestion(previous: string | null, rand: () => number = Math.random): Question {
  const pool = QUESTIONS.filter((q) => q.id !== previous);
  return pool[Math.floor(rand() * pool.length)]!;
}
