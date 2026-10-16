import { describe, expect, it } from "vitest";
import {
  SAMPLE_CITY,
  companiesFor,
  currencySymbol,
  gradeCopy,
  regionExamples,
  regionWords,
  sampleCity,
  scamReport,
} from "./regionCopy";

describe("per-country examples", () => {
  it("keeps India's examples exactly as they were written", () => {
    const india = regionExamples("in");
    expect(india).toMatchObject({
      otherCity: "Indore",
      company: "Infosys",
      jobTitle: "Systems Engineer",
      person: "Priya Sharma",
      referral: "We were batchmates at NIT Trichy",
      coldEmail: "Serving notice, can join in 30 days",
      followUp: "Applied on 2 October through Naukri",
      school: "IIT Delhi, or Delhi Public School (CBSE)",
      degree: "B.Tech, or Class 12 (PCM)",
    });
    expect(gradeCopy("IN")).toEqual({
      label: "CGPA or percentage (optional)",
      hint: "As on your marksheet, with the scale.",
      placeholder: "8.6 / 10 CGPA, or 92%",
      word: "CGPA",
    });
    expect(sampleCity("IN")).toBe("Bengaluru");
  });

  it("gives the countries we know their own, and everyone else something neutral", () => {
    expect(regionExamples("US").school).toBe("University of Texas at Austin");
    expect(regionExamples("GB").school).toBe("University of Manchester");
    expect(gradeCopy("US")).toMatchObject({ label: "GPA (optional)", placeholder: "3.7 / 4.0 GPA" });
    expect(gradeCopy("GB").placeholder).toBe("First, or 2:1");
    expect(sampleCity("US")).toBe("Austin");
    expect(sampleCity("BR")).toBeNull();
    const world = regionExamples("BR");
    expect(world.otherCity).toBeNull();
    expect(gradeCopy(null).label).toBe("GPA or grade (optional)");
    // Nothing Indian outside India: no Indian schools, grades, job sites or names.
    for (const code of ["US", "GB", "CA", "AU", "DE", "IE", "BR", null]) {
      const text = JSON.stringify([regionExamples(code), gradeCopy(code), regionWords(code)]);
      for (const word of ["Naukri", "CGPA", "B.Tech", "Class 12", "IIT", "NIT", "batchmates", "Serving notice", "Priya", "Fresher", "HR round"]) {
        expect(text, `${code}: ${word}`).not.toContain(word);
      }
    }
    for (const city of Object.values(SAMPLE_CITY)) expect(city.length).toBeGreaterThan(2);
  });
});

describe("per-country words", () => {
  it("are India's own in India and international English elsewhere", () => {
    expect(regionWords("IN")).toMatchObject({ entryLevel: "Fresher", entryLevelQuery: "fresher", screen: "HR round", coldEmail: "Email to HR", campusTemplate: "Campus" });
    expect(regionWords("US")).toMatchObject({ entryLevel: "Entry level", entryLevelQuery: "entry-level", screen: "recruiter screen", coldEmail: "Email to a recruiter", campusTemplate: "Graduate" });
    expect(regionWords("US").studentLevel).toBe("Student / new grad");
    expect(regionWords("IN").studentLevel).toBe("Fresher");
  });

  it("writes the local money sign", () => {
    expect(currencySymbol("IN")).toBe("₹");
    expect(currencySymbol("US")).toBe("$");
    expect(currencySymbol("GB")).toBe("£");
    expect(currencySymbol("DE")).toBe("€");
    expect(currencySymbol(null)).toBe("$");
  });
});

describe("job-scam reporting", () => {
  it("names the national service where there's one", () => {
    expect(scamReport("IN")).toEqual({ links: [["cybercrime.gov.in", "https://cybercrime.gov.in/"]], phone: "1930", about: "the national cyber-crime helpline" });
    expect(scamReport("US")?.links.map(([label]) => label)).toEqual(["reportfraud.ftc.gov", "ic3.gov"]);
    expect(scamReport("GB")?.phone).toBe("0300 123 2040");
    expect(scamReport("FR")).toBeNull();
  });
});

describe("companies to practise for", () => {
  const styles = ["amazon", "flipkart", "tcs", "infosys", "google", "swiggy", "wipro", "razorpay", "zomato", "cognizant", "stripe"].map((slug) => ({ slug }));

  it("keeps India's list as it is", () => {
    expect(companiesFor(styles, "IN")).toEqual(styles);
  });

  it("leaves India-only companies out elsewhere and puts the IT-services firms last", () => {
    expect(companiesFor(styles, "US").map((s) => s.slug)).toEqual(["amazon", "google", "stripe", "tcs", "infosys", "wipro", "cognizant"]);
  });
});
