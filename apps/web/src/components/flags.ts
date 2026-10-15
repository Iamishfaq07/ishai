import type { User } from "@orbit/types";

/** Per-account feature flags the server sends on the user (default off until verified). */
export type UserFlag = "evidence_vault";

/** null while the account is loading; then whether the flag is on for it. */
export function flagAllows(user: Pick<User, UserFlag> | null | undefined, flag: UserFlag): boolean | null {
  if (!user) return null;
  return Boolean(user[flag]);
}
