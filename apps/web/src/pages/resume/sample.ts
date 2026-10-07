import type { ResumeData, ResumeDesign } from "@orbit/types";
import { defaultDesign } from "./model";

/**
 * The made-up resume on Resume AI's public page: an early-career data analyst in India, laid out the way the editor
 * prints it. `score` is what the ATS check gives it (POST /v1/resumes/score), so the badge beside it is real.
 */
export const SAMPLE_RESUME: { data: ResumeData; design: ResumeDesign; score: number } = {
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
