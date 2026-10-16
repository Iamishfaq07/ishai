/** What an application form field asks for, from its name, id, label, autocomplete and placeholder. */
export type ProfileKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "website";

export interface FieldInfo {
  name: string;
  id: string;
  label: string;
  autocomplete: string;
  placeholder: string;
  type: string;
}

const AUTOCOMPLETE: Record<string, ProfileKey> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "address-level2": "location",
  url: "website",
};

// Checked in order: the more specific first ("first name" before "name").
const RULES: [ProfileKey, RegExp][] = [
  ["linkedin", /linked\s*in/],
  ["github", /git\s*hub/],
  ["first_name", /\b(first|given|fore)\s*_?name\b|^fname$|firstname/],
  ["last_name", /\b(last|family|sur)\s*_?name\b|^lname$|lastname|surname/],
  ["email", /e-?mail/],
  ["phone", /phone|mobile|\btel\b|contact\s*number/],
  ["website", /website|portfolio|personal\s*(site|url)|\bblog\b/],
  ["location", /\b(current\s*)?(location|city)\b/],
  ["full_name", /\b(full\s*_?name|your\s*name|^name$)\b/],
];

// Never filled: the person answers these themselves.
const SKIP = /password|salary|ctc|notice|cover\s*letter|why|visa|sponsor|gender|race|ethnic|veteran|disab|pronoun|referr|\bage\b|date\s*of\s*birth|dob|captcha|otp|search/;

export function classifyField(f: FieldInfo): ProfileKey | null {
  if (["hidden", "password", "file", "checkbox", "radio", "submit", "button", "search"].includes(f.type)) return null;
  const auto = AUTOCOMPLETE[f.autocomplete.trim().toLowerCase()];
  const text = [f.label, f.name, f.id, f.placeholder].join(" ").replace(/[_\-[\]]+/g, " ").toLowerCase().trim();
  if (SKIP.test(text)) return null;
  if (auto) return auto;
  if (f.type === "email") return "email";
  if (f.type === "tel") return "phone";
  for (const [key, re] of RULES) if (re.test(text)) return key;
  return null;
}
