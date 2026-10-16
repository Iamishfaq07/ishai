import { describe, expect, it } from "vitest";
import { cleanText, jobFromJsonLd, jobFromTitle } from "./job";

describe("reading a job from the page", () => {
  it("takes schema.org JobPosting data, through @graph", () => {
    const blob = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ignore me" },
        {
          "@type": "JobPosting",
          title: "Backend Engineer",
          hiringOrganization: { "@type": "Organization", name: "Acme" },
          jobLocation: { "@type": "Place", address: { addressLocality: "Bengaluru", addressRegion: "KA", addressCountry: "IN" } },
          description: "<p>Build <b>APIs</b>&nbsp;in Python.</p><ul><li>Kafka</li></ul>",
        },
      ],
    });
    expect(jobFromJsonLd(["not json", blob], "https://acme.example/jobs/1")).toEqual({
      title: "Backend Engineer",
      company: "Acme",
      location: "Bengaluru, KA, IN",
      url: "https://acme.example/jobs/1",
      description: "Build APIs in Python.\nKafka",
    });
  });

  it("says remote for a telecommute post, and null with no posting", () => {
    const remote = JSON.stringify({ "@type": "JobPosting", title: "SRE", hiringOrganization: "Zed", jobLocationType: "TELECOMMUTE" });
    expect(jobFromJsonLd([remote], "u")?.location).toBe("Remote");
    expect(jobFromJsonLd([JSON.stringify({ "@type": "WebPage" })], "u")).toBeNull();
  });

  it("reads JSON-LD with raw line breaks inside strings, as some sites publish it", () => {
    const blob = '{"@type":"JobPosting","title":"SRE","hiringOrganization":{"name":"Zed"},"description":"Line one\nline two"}'; // a raw line break inside the string
    expect(blob).toContain("\n");
    expect(jobFromJsonLd([blob], "u")?.company).toBe("Zed");
  });

  it("falls back to the page title", () => {
    expect(jobFromTitle("Data Analyst at Flipkart | LinkedIn", "LinkedIn")).toEqual({ title: "Data Analyst", company: "Flipkart" });
    expect(jobFromTitle("Product Designer - Swiggy", "Swiggy careers")).toEqual({ title: "Product Designer", company: "Swiggy" });
    expect(jobFromTitle("Careers", "Acme")).toEqual({ title: "Careers", company: "Acme" });
  });

  it("cleans HTML to text", () => {
    expect(cleanText("a<br>b &amp; c")).toBe("a\nb & c");
    expect(cleanText("<p>We need <b>Python</b>, and <a href=x>Kafka</a>.</p>")).toBe("We need Python, and Kafka.");
  });
});
