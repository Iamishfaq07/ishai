import type { AnswerLength, AnswerStyle, ExperienceLevel, ResponseTiming, ThinkingLevel } from "@orbit/types";
import {
  ANSWER_LANGUAGE_HINT,
  ANSWER_STYLES,
  EXPERIENCE_LEVELS,
  Field,
  INTERVIEW_LANGUAGE_HINT,
  RESPONSE_TIMINGS,
  SegmentedControl,
  Select,
  THINKING_LEVELS,
  Textarea,
  answerLanguages,
  experienceLevels,
  interviewLanguages,
  offersLanguages,
} from "@orbit/ui";

export const LENGTHS: Array<{ value: AnswerLength; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "Fits each question: a line for a quick one, more for a deep one." },
  { value: "short", label: "Short", hint: "About 30 seconds to say." },
  { value: "standard", label: "Standard", hint: "About a minute to say." },
  { value: "detailed", label: "Detailed", hint: "The whole answer, for questions that need it." },
];

/** Step 4, how Orbit answers: the languages, the answer's length and style, when it answers, and how hard it thinks. */
export function AnswersStep({
  isMock,
  offered,
  language,
  answerLanguage,
  onLanguages,
  length,
  onLength,
  autoAnswer,
  onAutoAnswer,
  responseTiming,
  onResponseTiming,
  style,
  onStyle,
  experience,
  onExperience,
  thinking,
  onThinking,
  country,
  instructions,
  onInstructions,
}: {
  isMock: boolean;
  offered: string[] | undefined;
  language: string;
  answerLanguage: string;
  onLanguages: (heard: string, answer: string) => void;
  length: AnswerLength;
  onLength: (l: AnswerLength) => void;
  autoAnswer: boolean;
  onAutoAnswer: (on: boolean) => void;
  responseTiming: ResponseTiming;
  onResponseTiming: (t: ResponseTiming) => void;
  style: AnswerStyle;
  onStyle: (s: AnswerStyle) => void;
  experience: ExperienceLevel;
  onExperience: (l: ExperienceLevel) => void;
  thinking: ThinkingLevel;
  onThinking: (t: ThinkingLevel) => void;
  country: string | null;
  instructions: string;
  onInstructions: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {!isMock && offersLanguages(offered) && (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interview language" htmlFor="setup-heard">
              <Select id="setup-heard" value={language} onChange={(e) => onLanguages(e.target.value, answerLanguage)}>
                {interviewLanguages(offered).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Answer in" htmlFor="setup-answer-in">
              <Select id="setup-answer-in" value={answerLanguage} onChange={(e) => onLanguages(language, e.target.value)}>
                {answerLanguages(language, offered).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {INTERVIEW_LANGUAGE_HINT} {ANSWER_LANGUAGE_HINT}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p id="setup-length-label" className="mb-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Answer length
          </p>
          <SegmentedControl labelledBy="setup-length-label" options={LENGTHS.map(({ value, label }) => ({ value, label }))} value={length} onChange={onLength} />
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{LENGTHS.find((l) => l.value === length)?.hint}</p>
        </div>
        {!isMock && (
          <div className="min-w-0">
            <p id="setup-answering-label" className="mb-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Answering
            </p>
            <SegmentedControl
              labelledBy="setup-answering-label"
              options={[
                { value: "auto", label: "Automatic" },
                { value: "manual", label: "When I click Answer" },
              ]}
              value={autoAnswer ? "auto" : "manual"}
              onChange={(v) => onAutoAnswer(v === "auto")}
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {autoAnswer ? "Orbit answers each question it hears." : "Orbit waits for Answer (or its shortcut)."}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {!isMock && autoAnswer && (
          <Field label="Wait before answering" htmlFor="setup-timing" hint={RESPONSE_TIMINGS.find((t) => t.value === responseTiming)?.hint}>
            <Select id="setup-timing" value={responseTiming} onChange={(e) => onResponseTiming(e.target.value as ResponseTiming)}>
              {RESPONSE_TIMINGS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Answer style" htmlFor="setup-style" hint={ANSWER_STYLES.find((s) => s.value === style)?.hint}>
          <Select id="setup-style" value={style} onChange={(e) => onStyle(e.target.value as AnswerStyle)}>
            {ANSWER_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Your experience level" htmlFor="setup-experience" hint={`${EXPERIENCE_LEVELS.find((l) => l.value === experience)?.hint ?? ""}. Answers are pitched at it.`}>
          <Select id="setup-experience" value={experience} onChange={(e) => onExperience(e.target.value as ExperienceLevel)}>
            {experienceLevels(country).map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Thinking effort" htmlFor="setup-thinking" hint={THINKING_LEVELS.find((t) => t.value === thinking)?.hint}>
          <Select id="setup-thinking" value={thinking} onChange={(e) => onThinking(e.target.value as ThinkingLevel)}>
            {THINKING_LEVELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!isMock && (
        <Field label="Custom instructions (optional)" htmlFor="setup-instructions" hint="Applied to every answer. Saved with the setup.">
          <Textarea
            id="setup-instructions"
            value={instructions}
            onChange={(e) => onInstructions(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="e.g. Mention I'm relocating to Berlin. Use British spelling."
          />
        </Field>
      )}
    </div>
  );
}
