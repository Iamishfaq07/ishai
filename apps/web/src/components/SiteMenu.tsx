import { MobileMenu } from "../marketing/PublicHeader";

/**
 * The public pages' phone menu. Now the shared site menu (marketing/PublicHeader.tsx: the whole site as one sheet);
 * kept under this name so a page with its own header still gets it. New public pages should use `PublicLayout`.
 */
export function SiteMenu() {
  return <MobileMenu />;
}
