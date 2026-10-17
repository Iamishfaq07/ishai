import { PublicFooter } from "../marketing/PublicFooter";
import { useSiteScope } from "../marketing/useSiteScope";

/**
 * The public pages' footer. Now the shared site footer (marketing/PublicFooter.tsx), and a page that shows it is in
 * the front door's look (html.site); kept under this name so pages that still import it get both. New public pages
 * should use `PublicLayout`, which includes it with the shared header.
 */
export function Footer({ className }: { className?: string }) {
  useSiteScope();
  return <PublicFooter className={className} />;
}
