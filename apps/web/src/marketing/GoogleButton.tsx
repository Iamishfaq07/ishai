import { cx, focusRing } from "@orbit/ui";
import googleG from "./assets/google-g.svg";
import "./site.css";

/** The words Google allows on its button. */
export type GoogleLabel = "Sign in with Google" | "Sign up with Google" | "Continue with Google";

/**
 * Google sign-in, drawn to Google's branding guidelines (developers.google.com/identity/branding-guidelines): the
 * standard "G" exactly as Google supplies it (assets/google-g.svg, from Google's pre-approved assets, cropped to the
 * logo), 40 px tall, 12 px padding, 10 px between the G and the label, Google Sans Medium 14/20, white with a #747775
 * hairline in light mode and #131314 with #8E918F in dark mode (`.mk-google` in site.css). A link: Orbit's Google
 * sign-in is a server redirect, not Google's script.
 */
export function GoogleButton({ href, label, className }: { href: string; label: GoogleLabel; className?: string }) {
  return (
    <a href={href} className={cx("mk-google", focusRing, className)}>
      <img src={googleG} alt="" width={20} height={20} />
      <span>{label}</span>
    </a>
  );
}
