import { describe, expect, it } from "vitest";
import type { CompanyStyle, CreateSessionRequest } from "@orbit/types";
import { companyKey, matchStyle, withCompany } from "./companyStyle";

const style = (slug: string, name: string, aliases: string[]): CompanyStyle => ({ slug, name, aliases, rounds: [], looks_for: [], questions: [], tips: [] });
const STYLES = [style("amazon", "Amazon", ["aws"]), style("tcs", "TCS", ["tata consultancy services"]), style("goldman-sachs", "Goldman Sachs", [])];

const mock = (extra: Partial<NonNullable<CreateSessionRequest["mock"]>> = {}): CreateSessionRequest => ({
  title: "Mock", type: "mock", language: "en", length: "standard", style: "natural", auto_answer: false, document_ids: [],
  mock: { duration_minutes: 10, ...extra },
});

describe("company interview styles", () => {
  it("matches names, aliases and a known name leading the text", () => {
    expect(companyKey("Tata Consultancy Services Ltd.")).toBe("tata consultancy services");
    expect(matchStyle(STYLES, "AWS")?.name).toBe("Amazon");
    expect(matchStyle(STYLES, "Tata Consultancy Services Ltd.")?.name).toBe("TCS");
    expect(matchStyle(STYLES, "Amazon (India)")?.name).toBe("Amazon");
    expect(matchStyle(STYLES, "goldman sachs")?.slug).toBe("goldman-sachs");
    expect(matchStyle(STYLES, "Acme")).toBeNull();
    expect(matchStyle(STYLES, "  ")).toBeNull();
  });

  it("puts the company on the round, or on a negotiation's recruiter", () => {
    expect(withCompany(mock(), " Amazon ").mock?.company).toBe("Amazon");
    expect(withCompany(mock(), "")).toEqual(mock());
    const deal = withCompany(mock({ interview_type: "negotiation", negotiation: { offer: "₹20 LPA" } }), "Flipkart");
    expect(deal.mock?.negotiation?.company).toBe("Flipkart");
    expect(deal.mock?.company).toBeUndefined();
    const named = mock({ interview_type: "negotiation", negotiation: { offer: "₹20 LPA", company: "Swiggy" } });
    expect(withCompany(named, "Flipkart").mock?.negotiation?.company).toBe("Swiggy");
  });
});
