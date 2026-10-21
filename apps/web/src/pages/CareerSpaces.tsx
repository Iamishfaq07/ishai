import { useLocation } from "react-router-dom";
import { MyCareerPage } from "./career/MyCareerPage";
import { PreparePage } from "./prepare/PreparePage";

/** /prepare and /career share a route; each has its own page. */
export function CareerSpacesPage() {
  const prepare = useLocation().pathname.replace(/\/+$/, "") === "/prepare";
  return prepare ? <PreparePage /> : <MyCareerPage />;
}
