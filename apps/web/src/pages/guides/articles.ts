// Orbit's interview-prep articles (/guides/<slug>): written for a person preparing, in Orbit's own words, with a
// "last reviewed" date. `published: false` is a draft for the owner to review: the page exists at its address but is
// noindex, out of the sitemap and not linked from the site (DECISIONS D67, docs/SEO.md). Flip it once approved.
//
// Text may link inside the site with [words](/path); nothing else is markup.

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "example"; label: string; text: string }
  | { kind: "question"; question: string; covers: string[]; avoid?: string };

export interface GuideSection {
  id: string;
  heading: string;
  blocks: GuideBlock[];
}

export interface GuideArticle {
  slug: string;
  /** The page's <title> (with " | Orbit", at most 60 characters). */
  title: string;
  /** Its search snippet, 120 to 160 characters. */
  description: string;
  /** The heading on the page. */
  headline: string;
  /** The opening paragraph: the answer first. */
  summary: string;
  /** YYYY-MM-DD: when its facts were last checked. */
  reviewed: string;
  published: boolean;
  sections: GuideSection[];
  /** Where to go next on the site. */
  related: Array<{ label: string; to: string }>;
  sources?: Array<{ title: string; url: string }>;
}

export const GUIDES_PATH = "/guides";
export const guidePath = (slug: string): string => `${GUIDES_PATH}/${slug}`;

export const ARTICLES: GuideArticle[] = [
  {
    slug: "google-interview-warmup-alternatives",
    title: "Google Interview Warmup is gone: free alternatives | Orbit",
    description:
      "What Google's Interview Warmup did, what its address shows now, and free ways to keep practising interview answers out loud, with or without an account.",
    headline: "What happened to Google Interview Warmup, and free ways to practise instead",
    summary:
      "Google's Interview Warmup, the free tool that let you answer interview questions out loud and see your words played back, is no longer available. You can still practise the same way for free: answer common questions out loud, read back what you said, and check it for structure, examples and filler words.",
    reviewed: "2026-10-18",
    published: false,
    sections: [
      {
        id: "what-it-was",
        heading: "What Interview Warmup did",
        blocks: [
          {
            kind: "p",
            text: "Google announced Interview Warmup in 2022 as part of Grow with Google, first for people taking its career certificates and then for anyone. You picked a field, answered a few typical questions by speaking or typing, and read a transcript of your answer.",
          },
          {
            kind: "p",
            text: "It didn't score you. Instead it pointed out patterns: the job-related terms you used, the words you leaned on most, and which talking points you covered, such as your experience, skills, lessons learned and goals. That made it a calm, private place to hear yourself answer before a real interview.",
          },
        ],
      },
      {
        id: "what-now",
        heading: "What its address shows now",
        blocks: [
          {
            kind: "p",
            text: "When we checked on 18 October 2026, the tool's old address showed a page about preparing for interviews that suggests practising with Gemini Live in the Gemini app instead. We found no announcement from Google giving a date. If you had saved answers there, they aren't shown any more.",
          },
        ],
      },
      {
        id: "what-to-look-for",
        heading: "What a good replacement does",
        blocks: [
          {
            kind: "ul",
            items: [
              "Lets you answer out loud, because speaking an answer is a different skill from writing one.",
              "Shows you what you said, so you can spot rambling, missing examples and filler words.",
              "Uses questions close to your real interview: the common ones (tell me about yourself, strengths, a time you solved a problem) and some for your field.",
              "Is honest about what it keeps: a practice answer can mention your college, your employer or your family.",
              "Costs nothing to start, so you can practise every day in the week before an interview.",
            ],
          },
        ],
      },
      {
        id: "free-ways",
        heading: "Free ways to keep practising",
        blocks: [
          {
            kind: "ol",
            items: [
              "Orbit's [free interview warm-up](/warmup): five common questions, answered by speaking or typing, with tips straight away on length, structure, numbers, filler words and \"I\" against \"we\". No account needed.",
              "A general AI assistant, as Google now suggests: ask it to act as an interviewer for your role, one question at a time, and to tell you after each answer what was missing. Ask for one change at a time, or the advice gets vague.",
              "A friend, a senior or your placement cell: one 20-minute mock round with a person who interrupts and asks follow-ups is worth doing at least once.",
              "Your phone's voice recorder: answer five questions, play them back the same day, and note the first ten seconds of each. That's where most answers wander.",
            ],
          },
          {
            kind: "p",
            text: "Whatever you use, practise the questions your interviewers are likely to ask. The [company guides](/companies) list the rounds and the kind of questions candidates commonly report for each employer, and the [role guides](/roles) do the same for each kind of job.",
          },
        ],
      },
      {
        id: "a-routine",
        heading: "A 15-minute routine that works",
        blocks: [
          {
            kind: "ol",
            items: [
              "Pick three questions: one about you, one about your work or project, one about a problem you solved.",
              "Answer each out loud in under two minutes, without notes.",
              "Read back or listen to each answer. Mark where you lost the point, and any claim without an example or a number.",
              "Answer the weakest one again straight away.",
            ],
          },
          {
            kind: "p",
            text: "Do it daily for a week before an interview and the first minute of every answer gets noticeably sharper.",
          },
        ],
      },
    ],
    related: [
      { label: "Try the free interview warm-up", to: "/warmup" },
      { label: "Tell me about yourself: an answer for freshers", to: "/guides/tell-me-about-yourself-for-freshers" },
      { label: "Company interview guides", to: "/companies" },
    ],
    sources: [
      { title: "Google: Helping job seekers prepare for interviews (2022)", url: "https://blog.google/company-news/outreach-and-initiatives/grow-with-google/interview-warmup/" },
      { title: "Grow with Google: Interview Warmup's address today", url: "https://grow.google/interview-warmup/" },
    ],
  },
  {
    slug: "tell-me-about-yourself-for-freshers",
    title: "Tell me about yourself: answers for freshers | Orbit",
    description:
      "How to answer \"tell me about yourself\" as a fresher in four parts and under 90 seconds, with three sample answers and the mistakes interviewers notice first.",
    headline: "\"Tell me about yourself\": a four-part answer for freshers, with examples",
    summary:
      "Answer in four parts and keep it under 90 seconds: who you are now (your degree and your strongest skill), one thing you built or did that proves it, why this role, and a line that hands the conversation back. It's the first question in most interviews, so it sets the tone for everything after it.",
    reviewed: "2026-10-18",
    published: false,
    sections: [
      {
        id: "why-they-ask",
        heading: "Why interviewers ask it",
        blocks: [
          {
            kind: "p",
            text: "It isn't a request for your life story. The interviewer wants to hear how you sum yourself up, what you choose to lead with, and whether you can speak clearly for a minute. They'll often pick their next question from something you said, so mention what you'd like to be asked about.",
          },
        ],
      },
      {
        id: "four-parts",
        heading: "The four parts",
        blocks: [
          {
            kind: "ol",
            items: [
              "Now: your degree, college and the one or two skills you're strongest in. One or two sentences.",
              "Proof: your best project, internship or responsibility, with your own part in it and one result. This is the part people skip, and it's the part that's remembered.",
              "Why this role: what draws you to this job or company, in your own words, linked to the proof.",
              "Hand back: a short close such as \"That's why I applied for this role, and I'm happy to go into the project in more detail.\"",
            ],
          },
          {
            kind: "p",
            text: "Spoken at a normal pace that's 150 to 220 words, about 60 to 90 seconds. Practise until you can say it without reciting it: interviewers can tell when an answer has been memorised word for word.",
          },
        ],
      },
      {
        id: "examples",
        heading: "Three sample answers",
        blocks: [
          {
            kind: "p",
            text: "These are examples of the shape, not scripts. Swap in your own details: an answer built from someone else's achievements falls apart at the first follow-up question.",
          },
          {
            kind: "example",
            label: "Computer science fresher, applying to an IT services company",
            text: "I'm Priya, I've just finished my B.Tech in computer science, and I'm strongest in Java and SQL. For my final-year project, three of us built a library-management app; I wrote the database layer and cut the search time for the catalogue from several seconds to under one by adding indexes. I enjoyed working through a client's requirements with our guide, which is a big part of why I've applied here: your projects put freshers in front of real clients early. I'm happy to walk you through the project.",
          },
          {
            kind: "example",
            label: "Commerce graduate, applying for a customer support role",
            text: "I'm Arjun, I graduated in B.Com this year. Alongside college I worked weekends at my uncle's electronics shop, handling returns and complaints, and I learned to calm people down and fix the problem before it grew. I set up a simple register of repeat issues, which helped us cut repeat complaints about one product line. I'd like to do that at a bigger scale, and your support team works with customers across India, which suits my Hindi and English. I can tell you more about the shop if that helps.",
          },
          {
            kind: "example",
            label: "MBA fresher, applying for a business analyst role",
            text: "I'm Neha, I've just completed my MBA in marketing and analytics, after a B.Sc in statistics. In my summer internship at a consumer goods company I analysed six months of distributor orders and showed that most stock-outs came from three districts; my recommendation to reorder weekly there was piloted before I left. I like work where the numbers lead to a decision, which is what drew me to this analyst role. I'd be glad to talk through that analysis.",
          },
        ],
      },
      {
        id: "mistakes",
        heading: "Mistakes interviewers notice first",
        blocks: [
          {
            kind: "ul",
            items: [
              "Repeating your resume line by line, starting from school. They have the resume; tell them what it adds up to.",
              "Personal details nobody asked for: your family, your hometown's history, your hobbies list. One personal line is fine if it's relevant.",
              "Only adjectives: \"hard-working, passionate, a quick learner\" with nothing to show for it. One example beats five adjectives.",
              "Going past two minutes. If you're still talking at two minutes, cut the past and keep the proof.",
              "A different answer every time. Settle the four parts, then vary the words.",
            ],
          },
        ],
      },
      {
        id: "practise",
        heading: "Practise it out loud",
        blocks: [
          {
            kind: "p",
            text: "Say it out loud five times over two days and time it. The [free warm-up](/warmup) asks this question first and checks your answer's length, structure and filler words as you go. For a company's own style of first round, see its guide, for example [TCS](/companies/tcs), [Infosys](/companies/infosys) or [Wipro](/companies/wipro).",
          },
        ],
      },
    ],
    related: [
      { label: "HR interview questions for freshers", to: "/guides/hr-interview-questions-for-freshers" },
      { label: "Campus placement interview guide", to: "/roles/campus-placement" },
      { label: "Try the free interview warm-up", to: "/warmup" },
    ],
  },
  {
    slug: "hr-interview-questions-for-freshers",
    title: "HR interview questions for freshers, explained | Orbit",
    description:
      "The HR round's common questions for freshers in India, from \"why should we hire you\" to relocation, shifts and bonds, with what a good answer covers for each.",
    headline: "HR interview questions for freshers, and what a good answer covers",
    summary:
      "The HR round checks three things: that you can talk about yourself clearly, that you want this job and not just any job, and that the practical details work (location, shifts, joining date, the offer's terms). Prepare a true, short answer for each question below and you'll rarely be surprised.",
    reviewed: "2026-10-18",
    published: false,
    sections: [
      {
        id: "about-you",
        heading: "About you",
        blocks: [
          {
            kind: "question",
            question: "Tell me about yourself.",
            covers: ["Your degree and strongest skill", "One project or responsibility with your own part in it", "Why this role, in a line"],
            avoid: "Your school marks and family background. See [the full guide to this question](/guides/tell-me-about-yourself-for-freshers).",
          },
          {
            kind: "question",
            question: "What are your strengths?",
            covers: ["Two strengths that matter for this job", "A short example for each", "How you'd use them here"],
            avoid: "A list of adjectives with no proof.",
          },
          {
            kind: "question",
            question: "What is your biggest weakness?",
            covers: ["A real weakness that won't stop you doing the job", "What you're doing about it", "A sign it's improving"],
            avoid: "Disguised boasts (\"I work too hard\"); interviewers have heard them all.",
          },
          {
            kind: "question",
            question: "Is there a gap or a backlog in your education?",
            covers: ["The plain reason, in a sentence", "What you did in that time or how you cleared it", "That it's behind you"],
            avoid: "Long explanations or blaming others. If your offer depends on clearing a backlog, say when you will.",
          },
        ],
      },
      {
        id: "motivation",
        heading: "Why this job",
        blocks: [
          {
            kind: "question",
            question: "Why do you want to join our company?",
            covers: ["Something specific about the company: its work, clients, training or values", "How it fits what you've done", "What you want to learn there"],
            avoid: "\"It's a big brand\" or \"good salary\". Read the company's careers page and a recent news item first.",
          },
          {
            kind: "question",
            question: "Why should we hire you?",
            covers: ["The two or three things the job needs", "Your proof for each", "One line on attitude: that you'll learn fast"],
            avoid: "Comparing yourself with other candidates you don't know.",
          },
          {
            kind: "question",
            question: "Where do you see yourself in five years?",
            covers: ["Growing in this field, with more responsibility", "Skills you want to have by then", "That it can happen here"],
            avoid: "Plans to leave for higher studies or another career, unless the role is short by design.",
          },
        ],
      },
      {
        id: "situations",
        heading: "How you work",
        blocks: [
          {
            kind: "question",
            question: "Tell me about a time you worked in a team and something went wrong.",
            covers: ["The situation, briefly", "What you did yourself", "The result and what you'd do differently"],
            avoid: "A story where the problem was everyone else.",
          },
          {
            kind: "question",
            question: "How do you handle pressure or a tight deadline?",
            covers: ["A real deadline from college, an internship or a job", "How you planned and what you dropped", "How it turned out"],
          },
          {
            kind: "question",
            question: "Are you comfortable learning a new technology or domain?",
            covers: ["Something you taught yourself recently", "How you learned it", "How long it took to be useful"],
          },
        ],
      },
      {
        id: "practical",
        heading: "The practical questions",
        blocks: [
          {
            kind: "p",
            text: "These have no clever answer. Be honest: a \"yes\" you don't mean becomes a problem after you join.",
          },
          {
            kind: "question",
            question: "Are you willing to relocate?",
            covers: ["Yes, or the cities you can't move to and why", "If you have a preference, say it once and politely"],
          },
          {
            kind: "question",
            question: "Can you work in night shifts or rotational shifts?",
            covers: ["A clear yes or no", "Any limit (for example, a few months, or transport at night)"],
          },
          {
            kind: "question",
            question: "Are you okay with a service agreement or bond?",
            covers: ["That you've read what the offer says: its length and what leaving early costs", "Your honest answer", "A question if anything is unclear"],
            avoid: "Agreeing to terms you haven't seen. Ask for them in writing.",
          },
          {
            kind: "question",
            question: "What salary do you expect?",
            covers: ["For campus and fresher roles the package is usually fixed: say you're comfortable with the offered range", "If asked for a number, a range based on the role and city"],
            avoid: "A number you can't explain.",
          },
          {
            kind: "question",
            question: "When can you join?",
            covers: ["Your real date: final exams, results or notice period", "Flexibility if you have it"],
          },
        ],
      },
      {
        id: "closing",
        heading: "The last question",
        blocks: [
          {
            kind: "question",
            question: "Do you have any questions for us?",
            covers: ["One or two real questions: the first project or training, how the team works, what success looks like in the first months"],
            avoid: "\"No\", or questions about leave and appraisals in the first interview.",
          },
        ],
      },
      {
        id: "prepare",
        heading: "How to prepare in an evening",
        blocks: [
          {
            kind: "ol",
            items: [
              "Write one line of proof for each question above: a project, a job, a responsibility.",
              "Read the company's careers page and, if it has one, its guide in the [company guides](/companies).",
              "Answer five of these out loud and time them: under two minutes each. The [free warm-up](/warmup) does this with instant tips.",
              "Decide your honest answers to the practical questions before the interview, not during it.",
            ],
          },
        ],
      },
    ],
    related: [
      { label: "Tell me about yourself: an answer for freshers", to: "/guides/tell-me-about-yourself-for-freshers" },
      { label: "Campus placement interview guide", to: "/roles/campus-placement" },
      { label: "Company interview guides", to: "/companies" },
    ],
  },
];

export const articleFor = (slug: string): GuideArticle | null => ARTICLES.find((a) => a.slug === slug) ?? null;
export const publishedArticles = (): GuideArticle[] => ARTICLES.filter((a) => a.published);
