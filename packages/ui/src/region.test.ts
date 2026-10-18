import { describe, expect, it } from "vitest";
import { COUNTRIES, countryName, currencyFor, detectCountry, formatNumber, isIndia, rupees, sampleOffer, wholeMinutes } from "./region";

describe("region", () => {
  it("lists India first and every country once", () => {
    expect(COUNTRIES[0]).toEqual({ code: "IN", name: "India" });
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(countryName("gb")).toBe("United Kingdom");
    expect(isIndia("in") && !isIndia("US") && !isIndia(null)).toBe(true);
  });

  it("guesses from the time zone, then the language, then India", () => {
    expect(detectCountry("Asia/Kolkata", ["en-US"])).toBe("IN");
    expect(detectCountry("Europe/London", ["en-US"])).toBe("GB");
    expect(detectCountry("Australia/Sydney", [])).toBe("AU");
    expect(detectCountry("America/Bogota", ["es-CO"])).toBe("CO");
    expect(detectCountry("America/Guatemala", ["es-MX", "en"])).toBe("MX"); // an unlisted zone: the language says
    expect(detectCountry(undefined, ["en"])).toBe("IN");
    expect(detectCountry("Etc/UTC", [])).toBe("IN");
  });

  it("writes money and numbers the local way", () => {
    expect(currencyFor("DE")).toBe("EUR");
    expect(currencyFor("ZZ")).toBe("USD");
    expect(formatNumber(100000, "IN")).toBe("1,00,000");
    expect(formatNumber(100000, "US")).toBe("100,000");
    expect(sampleOffer("IN").offer).toContain("LPA");
    expect(sampleOffer("US").offer).toContain("$");
    expect(sampleOffer("ES").offer).toContain("€"); // a euro country without its own sample
    expect(sampleOffer(null).offer).toContain("$");
  });
});

describe("speech language", () => {
  it("hears each country's English, or US English", async () => {
    const { speechLang } = await import("./region");
    expect(speechLang("IN")).toBe("en-IN");
    expect(speechLang("gb")).toBe("en-GB");
    expect(speechLang("DE")).toBe("en-US");
  });
});

describe("rupees", () => {
  it("groups the way India writes amounts, never a bare ₹26499", () => {
    expect(rupees(499)).toBe("₹499");
    expect(rupees(1649)).toBe("₹1,649");
    expect(rupees(26499)).toBe("₹26,499");
    expect(rupees(150000)).toBe("₹1,50,000");
    expect(rupees(499.5)).toBe("₹499.50");
  });
});

describe("minutes left", () => {
  it("round down, as the support bot counts them", () => {
    expect([15.9, 59.97, 0.4, 0, -2, 317.3].map(wholeMinutes)).toEqual([15, 60, 0, 0, 0, 317]);
  });
});
