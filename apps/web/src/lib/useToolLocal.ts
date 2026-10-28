import { useEffect, useRef, useState } from "react";
import { readJSON, safeLocal } from "@orbit/ui";
import { useAuth } from "./auth";

/** Device-only history/preferences, isolated by account and cleared by sign-out/account-switch cleanup. */
export function useToolLocal<T>(name: string, empty: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const { user } = useAuth();
  const owner = user?.id ?? "";
  const current = useRef(owner); current.current = owner;
  const key = `orbit.tool-local.${owner}.${name}`;
  const [stored, setStored] = useState(() => ({ owner, value: owner ? readJSON(safeLocal, key, empty, valid) : empty }));
  useEffect(() => { setStored({ owner, value: owner ? readJSON(safeLocal, key, empty, valid) : empty }); }, [owner, key, empty, valid]);
  return [stored.owner === owner ? stored.value : empty, (value) => {
    if (!owner || current.current !== owner || !valid(value)) return;
    setStored({ owner, value }); safeLocal.setItem(key, JSON.stringify(value));
  }];
}
