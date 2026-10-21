/**
 * Adjacent job titles (career-ops' `titles` mode: widen a search with titles that ask for much the same skills).
 * Families of titles employers use for overlapping work; a target title finds its family by its words, and the rest
 * of the family are the suggestions. A curated list, not a model: nothing about the candidate is assumed.
 */

const FAMILIES: { match: RegExp; titles: string[] }[] = [
  { match: /\b(?:backend|back-end|server|api|java|python|golang|node(?:\.?js)?)\b.*\b(?:engineer|developer)\b/i,
    titles: ["Backend Engineer", "Software Engineer", "API Developer", "Platform Engineer", "Java Developer", "Python Developer"] },
  { match: /\b(?:frontend|front-end|ui|react|angular|web)\b.*\b(?:engineer|developer)\b/i,
    titles: ["Frontend Engineer", "React Developer", "UI Engineer", "Web Developer", "Full Stack Developer"] },
  { match: /\b(?:full[\s-]?stack|mern|mean)\b/i,
    titles: ["Full Stack Developer", "Software Engineer", "Web Developer", "Backend Engineer", "Frontend Engineer"] },
  { match: /\b(?:software|sde|application)\b.*\b(?:engineer|developer)\b|\bsde\b/i,
    titles: ["Software Engineer", "Software Developer", "Application Developer", "Backend Engineer", "Graduate Engineer Trainee"] },
  { match: /\b(?:devops|sre|site reliability|cloud|infrastructure|platform)\b/i,
    titles: ["DevOps Engineer", "Site Reliability Engineer", "Cloud Engineer", "Platform Engineer", "Infrastructure Engineer"] },
  { match: /\b(?:data\s+analyst|business\s+analyst|mis|reporting|bi\b|business\s+intelligence)\b/i,
    titles: ["Data Analyst", "Business Analyst", "BI Analyst", "Reporting Analyst", "MIS Executive", "Product Analyst"] },
  { match: /\b(?:data\s+scien|machine\s+learning|ml\b|ai\b|deep\s+learning|nlp)\b/i,
    titles: ["Data Scientist", "Machine Learning Engineer", "AI Engineer", "Applied Scientist", "Data Analyst"] },
  { match: /\b(?:data\s+engineer|etl|big\s+data|analytics\s+engineer)\b/i,
    titles: ["Data Engineer", "Analytics Engineer", "ETL Developer", "Big Data Engineer", "Backend Engineer"] },
  { match: /\b(?:qa|quality|test(?:ing)?|sdet|automation\s+test)\b/i,
    titles: ["QA Engineer", "Test Engineer", "SDET", "Automation Tester", "Quality Analyst"] },
  { match: /\b(?:android|ios|mobile|flutter|react\s+native)\b/i,
    titles: ["Mobile Developer", "Android Developer", "iOS Developer", "Flutter Developer", "React Native Developer"] },
  { match: /\b(?:security|cyber|soc|penetration|appsec|infosec)\b/i,
    titles: ["Security Analyst", "SOC Analyst", "Security Engineer", "Cybersecurity Analyst", "Application Security Engineer"] },
  { match: /\b(?:product\s+manager|product\s+owner|apm)\b/i,
    titles: ["Product Manager", "Associate Product Manager", "Product Owner", "Product Analyst", "Program Manager"] },
  { match: /\b(?:project|program|delivery)\s+(?:manager|coordinator|lead)\b|\bscrum\b/i,
    titles: ["Project Manager", "Program Manager", "Delivery Manager", "Scrum Master", "Project Coordinator"] },
  { match: /\b(?:ui|ux|product|visual|graphic|interaction)\s+design/i,
    titles: ["UX Designer", "UI Designer", "Product Designer", "Interaction Designer", "Visual Designer"] },
  { match: /\b(?:sales|business\s+development|bde|account\s+executive|inside\s+sales)\b/i,
    titles: ["Business Development Executive", "Sales Executive", "Inside Sales Representative", "Account Executive", "Customer Success Manager"] },
  { match: /\b(?:marketing|seo|content|social\s+media|growth|brand)\b/i,
    titles: ["Digital Marketing Executive", "Marketing Associate", "Content Writer", "SEO Specialist", "Social Media Manager", "Growth Associate"] },
  { match: /\b(?:customer\s+(?:support|service|success)|support\s+engineer|technical\s+support|helpdesk)\b/i,
    titles: ["Customer Support Executive", "Technical Support Engineer", "Customer Success Associate", "Service Desk Analyst", "Implementation Specialist"] },
  { match: /\b(?:hr|human\s+resources|recruit(?:er|ment)|talent\s+acquisition)\b/i,
    titles: ["HR Executive", "Recruiter", "Talent Acquisition Specialist", "HR Generalist", "People Operations Associate"] },
  { match: /\b(?:account(?:ant|s|ing)|finance|audit|tax|ca\b|financial\s+analyst)\b/i,
    titles: ["Accountant", "Financial Analyst", "Accounts Executive", "Audit Associate", "Tax Associate"] },
  { match: /\b(?:operations|supply\s+chain|logistics|procurement)\b/i,
    titles: ["Operations Executive", "Supply Chain Analyst", "Logistics Coordinator", "Procurement Executive", "Operations Analyst"] },
];

/** Titles near the given ones, without those already chosen; at most `limit`. */
export function adjacentTitles(titles: string[], limit = 8): string[] {
  const have = new Set(titles.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const t of titles) {
    for (const f of FAMILIES) {
      if (!f.match.test(t)) continue;
      for (const s of f.titles) if (!have.has(s.toLowerCase()) && !out.includes(s)) out.push(s);
    }
  }
  return out.slice(0, limit);
}
