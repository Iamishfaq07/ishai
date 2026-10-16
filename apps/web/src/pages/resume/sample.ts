import type { ResumeData, ResumeDesign } from "@orbit/types";
import { countryName, isIndia, sampleCity } from "@orbit/ui";
import { defaultDesign } from "./model";

export interface SampleResume {
  data: ResumeData;
  design: ResumeDesign;
  score: number;
}

/**
 * The made-up resume on Resume AI's public page: an early-career data analyst, laid out the way the editor prints it,
 * written for where the visitor applies (India's as it always was; the US and Canada on Letter paper; the UK; and an
 * international one, set in the visitor's country). `score` is what the ATS check gives it (POST /v1/resumes/score),
 * so the badge beside it is real.
 */
export const SAMPLE_RESUME: SampleResume = {
  data: {
    basics: {
      name: "Ananya Iyer",
      headline: "Data Analyst · SQL, Python, Power BI",
      email: "ananya.iyer@example.com",
      phone: "+91 98765 43210",
      location: "Bengaluru, India",
      links: [{ label: "LinkedIn", url: "linkedin.com/in/ananya-iyer" }],
      summary:
        "Data analyst with two years of experience turning sales and inventory data into dashboards that store teams use every week. Strong in SQL, Python and Power BI, and in explaining numbers to people who don't work with them.",
    },
    experience: [
      {
        id: "x1",
        title: "Data Analyst",
        company: "Dhan Retail Pvt. Ltd.",
        location: "Bengaluru",
        start: "Jul 2023",
        end: "",
        current: true,
        bullets: [
          "Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.",
          "Automated the monthly inventory report with Python and SQL, cutting it from 2 days to 3 hours.",
          "Found ₹18 lakh a year in avoidable stock write-offs by analysing returns across 120 stores.",
        ],
      },
      {
        id: "x2",
        title: "Analytics Intern",
        company: "Insight Labs",
        location: "Pune",
        start: "Jan 2023",
        end: "Jun 2023",
        current: false,
        bullets: [
          "Cleaned and joined three years of customer data (1.2M rows) for the team's churn model.",
          "Presented weekly findings to the product team; two of them became roadmap items.",
        ],
      },
    ],
    education: [
      {
        id: "e1",
        school: "Pune Institute of Technology",
        degree: "B.Tech",
        field: "Computer Science",
        start: "2019",
        end: "2023",
        grade: "8.6 / 10 CGPA",
        details: "",
      },
    ],
    skills: [
      { id: "s1", name: "Analysis", items: ["SQL", "Python (pandas)", "Excel", "Statistics", "A/B testing"] },
      { id: "s2", name: "Tools", items: ["Power BI", "Tableau", "BigQuery", "Git"] },
    ],
    projects: [
      {
        id: "p1",
        name: "IPL score predictor",
        link: "",
        description: "",
        bullets: ["A regression model on 10 seasons of match data that called 82% of 2023's results."],
      },
    ],
    certifications: [{ id: "c1", name: "Google Data Analytics Certificate", issuer: "Coursera", date: "2023" }],
    extras: [],
    section_order: ["summary", "experience", "skills", "projects", "education", "certifications"],
  },
  design: { ...defaultDesign(), template: "modern", accent: "#4f46e5", font: "inter" },
  score: 98, // POST /v1/resumes/score: "Strong"; the one check it misses is length (179 words)
};

/** The same analyst in the United States: dollars, a GPA, a B.S. and Letter paper. */
const US_SAMPLE: SampleResume = {
  data: {
    ...SAMPLE_RESUME.data,
    basics: {
      name: "Jordan Rivera",
      headline: "Data Analyst · SQL, Python, Power BI",
      email: "jordan.rivera@example.com",
      phone: "(512) 555-0143",
      location: "Austin, TX",
      links: [{ label: "LinkedIn", url: "linkedin.com/in/jordan-rivera" }],
      summary: SAMPLE_RESUME.data.basics.summary,
    },
    experience: [
      {
        id: "x1",
        title: "Data Analyst",
        company: "Lone Star Retail Group",
        location: "Austin, TX",
        start: "Jul 2023",
        end: "",
        current: true,
        bullets: [
          "Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.",
          "Automated the monthly inventory report with Python and SQL, cutting it from 2 days to 3 hours.",
          "Found $220,000 a year in avoidable stock write-offs by analyzing returns across 120 stores.",
        ],
      },
      {
        id: "x2",
        title: "Analytics Intern",
        company: "Insight Labs",
        location: "Dallas, TX",
        start: "Jan 2023",
        end: "May 2023",
        current: false,
        bullets: [
          "Cleaned and joined three years of customer data (1.2M rows) for the team's churn model.",
          "Presented weekly findings to the product team; two of them became roadmap items.",
        ],
      },
    ],
    education: [
      { id: "e1", school: "University of Texas at Austin", degree: "B.S.", field: "Computer Science", start: "2019", end: "2023", grade: "3.7 / 4.0 GPA", details: "" },
    ],
    projects: [
      {
        id: "p1",
        name: "NBA game predictor",
        link: "",
        description: "",
        bullets: ["A regression model on 10 seasons of game data that called 71% of the 2023 season's results."],
      },
    ],
  },
  design: { ...defaultDesign("US"), template: "modern", accent: "#4f46e5", font: "inter" },
  score: 98, // POST /v1/resumes/score: "Strong"; misses only length, as India's does (and so does Canada's)
};

/** Canada: the US one in Toronto. */
const CA_SAMPLE: SampleResume = {
  ...US_SAMPLE,
  data: {
    ...US_SAMPLE.data,
    basics: { ...US_SAMPLE.data.basics, phone: "(416) 555-0143", location: "Toronto, ON" },
    experience: US_SAMPLE.data.experience.map((e, i) => ({ ...e, company: i === 0 ? "Maple Leaf Retail Inc." : e.company, location: i === 0 ? "Toronto, ON" : "Waterloo, ON" })),
    education: [{ ...US_SAMPLE.data.education[0]!, school: "University of Toronto", degree: "BSc" }],
  },
};

/** The United Kingdom: pounds, a degree classification and A4. */
const GB_SAMPLE: SampleResume = {
  data: {
    ...SAMPLE_RESUME.data,
    basics: {
      name: "Amelia Hughes",
      headline: "Data Analyst · SQL, Python, Power BI",
      email: "amelia.hughes@example.com",
      phone: "+44 7700 900123",
      location: "Manchester, UK",
      links: [{ label: "LinkedIn", url: "linkedin.com/in/amelia-hughes" }],
      summary: SAMPLE_RESUME.data.basics.summary,
    },
    experience: [
      {
        ...SAMPLE_RESUME.data.experience[0]!,
        company: "Northpoint Retail Ltd",
        location: "Manchester",
        bullets: [
          "Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.",
          "Automated the monthly inventory report with Python and SQL, cutting it from 2 days to 3 hours.",
          "Found £180,000 a year in avoidable stock write-offs by analysing returns across 120 stores.",
        ],
      },
      { ...SAMPLE_RESUME.data.experience[1]!, location: "Leeds" },
    ],
    education: [
      { id: "e1", school: "University of Manchester", degree: "BSc", field: "Computer Science", start: "2019", end: "2023", grade: "First Class Honours", details: "" },
    ],
    projects: [
      {
        id: "p1",
        name: "Premier League score predictor",
        link: "",
        description: "",
        bullets: ["A regression model on 10 seasons of match data that called 64% of the 2022/23 results."],
      },
    ],
  },
  design: SAMPLE_RESUME.design,
  score: 98, // POST /v1/resumes/score: "Strong"; misses only length
};

/** Everywhere else: no currency, a bachelor's degree, set in the visitor's country (its main city when we know it). */
function worldSample(country: string): SampleResume {
  const city = sampleCity(country);
  const name = countryName(country);
  const where = city && name ? `${city}, ${name}` : name || "Remote";
  return {
    data: {
      ...SAMPLE_RESUME.data,
      basics: {
        name: "Alex Morgan",
        headline: "Data Analyst · SQL, Python, Power BI",
        email: "alex.morgan@example.com",
        phone: "",
        location: where,
        links: [{ label: "LinkedIn", url: "linkedin.com/in/alex-morgan" }],
        summary: SAMPLE_RESUME.data.basics.summary,
      },
      experience: [
        {
          ...SAMPLE_RESUME.data.experience[0]!,
          company: "Harbour Retail Group",
          location: city ?? "",
          bullets: [
            "Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.",
            "Automated the monthly inventory report with Python and SQL, cutting it from 2 days to 3 hours.",
            "Cut avoidable stock write-offs by 18% by analysing returns across 120 stores.",
          ],
        },
        { ...SAMPLE_RESUME.data.experience[1]!, location: "Remote" },
      ],
      education: [
        { id: "e1", school: "City University", degree: "BSc", field: "Computer Science", start: "2019", end: "2023", grade: "3.7 / 4.0 GPA", details: "" },
      ],
      projects: [
        {
          id: "p1",
          name: "Football score predictor",
          link: "",
          description: "",
          bullets: ["A regression model on 10 seasons of league data that called 64% of 2023's results."],
        },
      ],
    },
    design: SAMPLE_RESUME.design,
    score: 96, // POST /v1/resumes/score: "Strong"; misses length and the phone (no country to write it for)
  };
}

/** The sample for where the visitor applies. */
export function sampleResume(country: string): SampleResume {
  const c = country.toUpperCase();
  if (isIndia(c)) return SAMPLE_RESUME;
  if (c === "US") return US_SAMPLE;
  if (c === "CA") return CA_SAMPLE;
  if (c === "GB") return GB_SAMPLE;
  return worldSample(c);
}
