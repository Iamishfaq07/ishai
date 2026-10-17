import { useLayoutEffect } from "react";
import "./site.css";

/** Pages that are showing the front door right now (a page can mount while the last one unmounts). */
let mounted = 0;

/**
 * Puts the document in the front door's look (`html.site`, site.css) while a signed-out page is on screen: the white
 * canvas, Plex headings, no sky. The signed-in Layout sets `html.app-shell` the same way. A layout effect, so the
 * first paint is already right.
 */
export function useSiteScope(): void {
  useLayoutEffect(() => {
    mounted += 1;
    document.documentElement.classList.add("site");
    return () => {
      mounted -= 1;
      if (mounted === 0) document.documentElement.classList.remove("site");
    };
  }, []);
}
