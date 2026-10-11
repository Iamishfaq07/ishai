/**
 * The country a user is applying for jobs in (ISO 3166-1 alpha-2, the account's `country`), and what follows from it:
 * the currency and number style, sample salaries, and wording. India is the first market and keeps its own
 * conventions (₹, LPA, campus rounds); everywhere else gets worldwide ones. Before the account has a country (or
 * signed out), it's guessed from the browser's time zone and language, and India when there's no clue.
 */

export interface Country {
  code: string;
  name: string;
}

export const INDIA = "IN";

/** The countries the picker offers: India first, then the rest by name. The server accepts any ISO code. */
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India" },
  ...([
    ["AE", "United Arab Emirates"], ["AR", "Argentina"], ["AT", "Austria"], ["AU", "Australia"], ["BD", "Bangladesh"],
    ["BE", "Belgium"], ["BH", "Bahrain"], ["BR", "Brazil"], ["CA", "Canada"], ["CH", "Switzerland"], ["CL", "Chile"],
    ["CN", "China"], ["CO", "Colombia"], ["CZ", "Czechia"], ["DE", "Germany"], ["DK", "Denmark"], ["EG", "Egypt"],
    ["ES", "Spain"], ["FI", "Finland"], ["FR", "France"], ["GB", "United Kingdom"], ["GH", "Ghana"], ["GR", "Greece"],
    ["HK", "Hong Kong"], ["ID", "Indonesia"], ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"], ["JP", "Japan"],
    ["KE", "Kenya"], ["KR", "South Korea"], ["KW", "Kuwait"], ["LK", "Sri Lanka"], ["MX", "Mexico"], ["MY", "Malaysia"],
    ["NG", "Nigeria"], ["NL", "Netherlands"], ["NO", "Norway"], ["NP", "Nepal"], ["NZ", "New Zealand"], ["OM", "Oman"],
    ["PE", "Peru"], ["PH", "Philippines"], ["PK", "Pakistan"], ["PL", "Poland"], ["PT", "Portugal"], ["QA", "Qatar"],
    ["RO", "Romania"], ["SA", "Saudi Arabia"], ["SE", "Sweden"], ["SG", "Singapore"], ["TH", "Thailand"], ["TR", "Türkiye"],
    ["TW", "Taiwan"], ["US", "United States"], ["VN", "Vietnam"], ["ZA", "South Africa"],
  ] as const)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

const NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]));

export function countryName(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase();
  return NAME.get(c) ?? c;
}

export function isIndia(code: string | null | undefined): boolean {
  return (code ?? "").toUpperCase() === INDIA;
}

// Time zones that name their country, for the guess (a language like "en-US" is the default in much of the world, so
// the zone goes first). America/* zones that aren't listed are left to the language.
const ZONE: Record<string, string> = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE",
  "Europe/Paris": "FR", "Europe/Amsterdam": "NL", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Lisbon": "PT",
  "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Vienna": "AT", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Prague": "CZ",
  "Europe/Bucharest": "RO", "Europe/Athens": "GR", "Europe/Istanbul": "TR", "Asia/Dubai": "AE", "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Muscat": "OM", "Asia/Bahrain": "BH", "Asia/Jerusalem": "IL",
  "Asia/Tel_Aviv": "IL", "Africa/Cairo": "EG", "Asia/Singapore": "SG", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID",
  "Asia/Manila": "PH", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN", "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD", "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Katmandu": "NP", "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Accra": "GH", "America/Sao_Paulo": "BR",
  "America/Mexico_City": "MX", "America/Argentina/Buenos_Aires": "AR", "America/Buenos_Aires": "AR",
  "America/Santiago": "CL", "America/Bogota": "CO", "America/Lima": "PE", "Pacific/Auckland": "NZ",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA", "America/Winnipeg": "CA",
  "America/Halifax": "CA", "America/St_Johns": "CA", "America/Regina": "CA", "America/New_York": "US",
  "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US",
  "America/Anchorage": "US", "America/Detroit": "US", "Pacific/Honolulu": "US",
};

/** The browser's best guess at the country: its time zone, then its language's region, then India. */
export function detectCountry(
  zone: string | undefined = safeZone(),
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language],
): string {
  if (zone) {
    if (ZONE[zone]) return ZONE[zone]!;
    if (zone.startsWith("Australia/")) return "AU";
  }
  for (const lang of languages) {
    const region = lang.split("-")[1]?.toUpperCase();
    if (region && region.length === 2 && NAME.has(region)) return region;
  }
  return INDIA;
}

function safeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const CURRENCY: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD",
  OM: "OMR", BH: "BHD", SG: "SGD", MY: "MYR", ID: "IDR", PH: "PHP", TH: "THB", VN: "VND", JP: "JPY", KR: "KRW",
  CN: "CNY", HK: "HKD", TW: "TWD", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", ZA: "ZAR", NG: "NGN", KE: "KES",
  GH: "GHS", EG: "EGP", IL: "ILS", TR: "TRY", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
  RO: "RON", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
  DE: "EUR", FR: "EUR", NL: "EUR", ES: "EUR", IT: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", IE: "EUR", FI: "EUR",
  GR: "EUR",
};

export function currencyFor(code: string | null | undefined): string {
  return CURRENCY[(code ?? "").toUpperCase()] ?? "USD";
}

/** How numbers are written there: "en-IN" groups lakhs (1,00,000), "en-GB" and "en-US" thousands. */
export function localeFor(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase();
  return c ? `en-${c}` : "en-US";
}

/** A number the way that country writes it ("1,00,000" in India, "100,000" elsewhere). */
export function formatNumber(n: number, code: string | null | undefined): string {
  try {
    return n.toLocaleString(localeFor(code));
  } catch {
    return n.toLocaleString("en-US");
  }
}

// A believable mid-level offer, and a target a fair step above it, in the way offers are written there.
const OFFERS: Record<string, [string, string]> = {
  IN: ["₹12 LPA fixed + ₹2 L variable", "₹15 LPA fixed"],
  US: ["$110,000 base + 10% bonus", "$125,000 base"],
  CA: ["CA$95,000 base + 10% bonus", "CA$108,000 base"],
  GB: ["£55,000 base + 5% bonus", "£62,000 base"],
  IE: ["€60,000 base + 5% bonus", "€68,000 base"],
  AU: ["A$115,000 base + super", "A$128,000 base + super"],
  NZ: ["NZ$95,000 base", "NZ$106,000 base"],
  AE: ["AED 25,000 a month, tax-free, + housing", "AED 29,000 a month"],
  SA: ["SAR 22,000 a month + housing", "SAR 26,000 a month"],
  SG: ["S$7,000 a month + 1-month bonus", "S$8,000 a month"],
  DE: ["€65,000 a year", "€72,000 a year"],
  NL: ["€58,000 a year + 8% holiday pay", "€65,000 a year"],
  FR: ["€50,000 a year", "€56,000 a year"],
  PK: ["PKR 300,000 a month", "PKR 350,000 a month"],
  PH: ["₱80,000 a month", "₱95,000 a month"],
};
const EUR_OFFER: [string, string] = ["€50,000 a year", "€56,000 a year"];
const ANY_OFFER: [string, string] = ["$60,000 a year base", "$68,000 a year base"];

/** A sample offer for salary-negotiation practice, and a target to aim for, in that country's terms. */
export function sampleOffer(code: string | null | undefined): { offer: string; target: string } {
  const c = (code ?? "").toUpperCase();
  const [offer, target] = OFFERS[c] ?? (currencyFor(c) === "EUR" ? EUR_OFFER : ANY_OFFER);
  return { offer, target };
}

// Countries whose English speech-to-text browsers know by name; everyone else is heard as US English.
const SPEECH_ENGLISH = new Set(["IN", "GB", "US", "AU", "CA", "NZ", "IE", "ZA", "PH", "SG", "NG", "KE", "GH", "PK"]);

/** The browser speech-to-text language for the country: its own English where there is one. */
export function speechLang(code: string | null | undefined): string {
  const c = (code ?? "").toUpperCase();
  return SPEECH_ENGLISH.has(c) ? `en-${c}` : "en-US";
}
