import { useState } from "react";
import { COUNTRIES, countryName } from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCountry } from "../lib/country";
import { errorText } from "../lib/format";
import { ErrorNote, Field, Select } from "./ui";

/**
 * "Country you're applying in": the account's job market. Saved as soon as it's picked; the currency, sample
 * salaries, practice wording and job search follow it everywhere. India is listed first.
 */
export function CountryField({ id = "country", hint, onChanged }: {
  id?: string;
  hint?: string;
  /** After the new country is saved (a page whose data depends on it reloads it). */
  onChanged?: (code: string) => void;
}) {
  const { user, setUser } = useAuth();
  const country = useCountry();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = COUNTRIES.some((c) => c.code === country);

  const change = async (code: string) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const u = await api.updateRegion(code);
      setUser((prev) => (prev ? { ...prev, country: u.country } : prev));
      onChanged?.(code);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Field label="Country you're applying in" htmlFor={id}
             hint={hint ?? "Prices, sample salaries, practice questions and job search follow it. Change it any time."}>
        <Select id={id} value={country} disabled={!user || saving} onChange={(e) => void change(e.target.value)}>
          {!known && <option value={country}>{countryName(country)}</option>}
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
