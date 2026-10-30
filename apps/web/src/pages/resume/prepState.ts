import { useState, type Dispatch, type SetStateAction } from "react";
import type { ResumeQuestionsResponse, ResumeSkillGapResponse } from "@orbit/types";

// The Interview prep tab's results, apart from the tab itself, so the editor can hold them while the tab's code
// loads only when it's opened (InterviewPrep.tsx).
export interface PrepState {
  questions: ResumeQuestionsResponse | null;
  picked: string[];
  gaps: ResumeSkillGapResponse | null;
  /** What each result was made from (the resume and job post), to say when the resume changed since. */
  questionsFor: string | null;
  gapsFor: string | null;
}

const EMPTY: PrepState = { questions: null, picked: [], gaps: null, questionsFor: null, gapsFor: null };

/** The tab's results, kept by the editor so they survive switching tabs. */
export function usePrepState(): [PrepState, Dispatch<SetStateAction<PrepState>>] {
  return useState<PrepState>(EMPTY);
}
