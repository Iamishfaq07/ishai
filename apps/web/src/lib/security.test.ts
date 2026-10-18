import { describe, expect, it } from "vitest";
import { isSecurityRole } from "./security";

describe("isSecurityRole", () => {
  it("knows security roles by their usual names", () => {
    for (const t of [
      "Security Analyst",
      "SOC Analyst L1",
      "Cybersecurity analyst",
      "Cyber Security Engineer",
      "Penetration Tester",
      "Pentester",
      "Ethical hacker",
      "InfoSec Engineer",
      "Information Security Officer",
      "GRC Analyst",
      "Cloud Security Engineer",
      "Application Security (AppSec) Lead",
      "Incident Response Analyst",
      "VAPT analyst",
      "DevSecOps Engineer",
    ]) {
      expect(isSecurityRole(t), t).toBe(true);
    }
  });

  it("leaves other roles alone", () => {
    for (const t of ["Product Analyst", "Software Engineer", "Data Scientist", "Social media manager", "Sales Executive", "Security guard rota planner"]) {
      expect(isSecurityRole(t), t).toBe(false);
    }
    expect(isSecurityRole(null, undefined, "")).toBe(false);
  });

  it("looks through every text it's given", () => {
    expect(isSecurityRole("Analyst", "Acme", "blue team")).toBe(true);
  });
});
