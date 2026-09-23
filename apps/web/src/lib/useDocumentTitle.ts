import { useEffect } from "react";

/** Sets the browser tab title (helpful with multiple sessions open); restores nothing — routes overwrite. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Orbit` : "Orbit";
  }, [title]);
}
