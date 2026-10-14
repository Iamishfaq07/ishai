import type { JobListing } from "@orbit/types";

/** Pages of the matches list after the first, so Back from a job finds the list as it was left. */
export interface ShownMore {
  key: string;
  items: JobListing[];
  page: number;
  hasMore: boolean;
}

// Kept outside the page so a job's page doesn't throw the extra pages away. Cleared with the account
// (useAsync.ts), so the next person on this browser never sees the last person's list.
let shownMore: ShownMore | null = null;
let autoSuggested = false;

export function getShownMore(): ShownMore | null {
  return shownMore;
}

export function setShownMore(value: ShownMore | null): void {
  shownMore = value;
}

/** The first-visit AI read of a resume into the job profile has already run in this tab. */
export function jobProfileWasSuggested(): boolean {
  return autoSuggested;
}

export function markJobProfileSuggested(): void {
  autoSuggested = true;
}

/** The account changed: the last person's matches and "already suggested" flag must not follow. */
export function resetJobsSession(): void {
  shownMore = null;
  autoSuggested = false;
}
