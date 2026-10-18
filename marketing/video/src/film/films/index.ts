import type { Film, Fmt } from "../engine";
import { LAYOUT } from "../shots/kit";
import { testFilm } from "./test";
import { liveTest } from "./live-test";
import { gallery } from "./gallery";
import { launchFilm } from "./launch";
import { cut15, cut30 } from "./cuts";
import { fCopilot, fDayloop, fJobs, fLanguages, fLearning, fLinkedin, fOffer, fPractice, fResume } from "./features";
import { sabaLong, sabaShort } from "./saba";

export type FilmOptions = { voice: boolean };
type Make = (fmt: Fmt, o: FilmOptions) => Film;
/** Feature films use the phone layout in square frames as well. */
const feature = (make: Make): Make => (fmt, o) => {
  LAYOUT.phoneSquare = true;
  return make(fmt, o);
};
export const FILMS: Record<string, Make> = {
  test: testFilm,
  "live-test": liveTest,
  gallery,
  launch: launchFilm,
  cut30,
  cut15,
  "f-copilot": feature(fCopilot),
  "f-practice": feature(fPractice),
  "f-resume": feature(fResume),
  "f-jobs": feature(fJobs),
  "f-dayloop": feature(fDayloop),
  "f-linkedin": feature(fLinkedin),
  "f-languages": feature(fLanguages),
  "f-offer": feature(fOffer),
  "f-learning": feature(fLearning),
  saba: feature(sabaLong),
  saba15: feature(sabaShort),
};
