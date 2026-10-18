export const LEARN_HOME = "/learn";
/** KashSec Academy: the Orbit team's free cybersecurity school (its own site), linked from Learning AI and beyond. */
export const KASHSEC_URL = "https://kashsec.vercel.app/";

/** Where a KashSec link sits, for the campaign tag (one name per placement). */
export type KashSecPlacement =
  | "learning"
  | "learning-tabs"
  | "home"
  | "front-page"
  | "footer"
  | "signin"
  | "matches"
  | "listing"
  | "mission"
  | "practice"
  | "role-guide"
  | "gallery";

/** KashSec's address with where it was found: utm_source=orbit, utm_medium=referral, utm_campaign=<placement>. */
export function kashsecUrl(placement: KashSecPlacement): string {
  return `${KASHSEC_URL}?utm_source=orbit&utm_medium=referral&utm_campaign=${placement}`;
}
