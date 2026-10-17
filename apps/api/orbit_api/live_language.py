"""Languages for live sessions (DECISIONS D62): what the interviewer speaks, and what the answers are written in.

English is the default, and an English session is exactly what it always was: the same transcription settings, the
same question detection (live/multilingual.ENGLISH is question_detector itself), the same prompts word for word.

The other languages are the ten Deepgram's Nova-3 streams in its multilingual code-switching mode: Hindi, Spanish,
French, German, Portuguese, Italian, Dutch, Japanese and Russian (plus English), with Hinglish (Hindi and English
mixed, the way Indian interviews often go) offered as its own choice. "auto" listens for any of them.

- Transcription: Hindi, Hinglish and auto use `language=multi` (code-switching, so English words in a Hindi sentence
  come out as English); the others use Nova-3's own model for that language, which Deepgram says is the more accurate
  choice when one language is spoken. Endpointing and utterance-end timings stay as English's: question detection is
  tuned to them, in every language. Filler words ("um") are an English-only Deepgram feature, so the mic asks for
  them only in English.
- Answers: written in the answer language ("same as the interview" by default; auto means the language each question
  was asked in), in the spoken register an interview in that language uses, with code and its identifiers in
  English. Length targets keep their speaking time: word counts are English words, so the prompt says how they
  translate, and the token budget grows by the language's share of extra tokens.
- The review and summaries are written in the answer language and say which (`language` on the report).

`ORBIT_LIVE_LANGUAGES=false` turns the choice off: every new and reopened live session is English again.
"""

from __future__ import annotations

from dataclasses import dataclass

from orbit_api.config import get_settings


@dataclass(frozen=True)
class LiveLanguage:
    code: str
    name: str  # in English, for prompts: "Spanish"
    label: str  # for the picker: "Español (Spanish)"
    deepgram: str  # Deepgram's `language` for Nova-3
    # Output tokens per English-word's worth of speech, relative to English (the model's tokenizer splits other
    # scripts into more pieces): the answer's token budget is scaled by it so a full-length answer isn't cut off.
    tokens: float
    # How the English word targets translate, said to the model.
    length: str
    # The register and script, said to the model.
    voice: str


_SAME_WORDS = "Length targets are counted in English words; keep their speaking time"
LANGUAGES: dict[str, LiveLanguage] = {lang.code: lang for lang in (
    LiveLanguage("en", "English", "English", "en", 1.0, "", ""),
    LiveLanguage("hi", "Hindi", "हिन्दी (Hindi)", "multi", 2.6,
                 f"{_SAME_WORDS}: in Hindi that's about 15% more words.",
                 "Write it in Devanagari, the way Indian professionals speak Hindi at work: technical words, "
                 "product names and acronyms stay in English, in Latin script (API, database, deadline, Python). Use "
                 "the respectful आप."),
    LiveLanguage("hinglish", "Hinglish", "Hinglish (Hindi + English)", "multi", 1.6,
                 f"{_SAME_WORDS}: in Hinglish that's about 10% more words.",
                 "Hinglish means the natural mix of Hindi and English Indian professionals use at work, written in "
                 "Latin script (Roman Hindi), for example \"Maine us project mein payment flow handle kiya tha, aur "
                 "usme latency kaafi kam ho gayi.\" Technical words stay in English. Use the respectful 'aap' forms."),
    LiveLanguage("es", "Spanish", "Español (Spanish)", "es", 1.6,
                 f"{_SAME_WORDS}: in Spanish that's about 15% more words.",
                 "Use the form of address the interviewer uses with you (tú or usted). Technical terms the way "
                 "Spanish-speaking engineers say them, often the English word (API, backend, deploy)."),
    LiveLanguage("fr", "French", "Français (French)", "fr", 1.6,
                 f"{_SAME_WORDS}: in French that's about 15% more words.",
                 "Use vous unless the interviewer uses tu with you. Technical terms the way French-speaking "
                 "engineers say them (often the English word: API, backend, cloud)."),
    LiveLanguage("de", "German", "Deutsch (German)", "de", 1.6,
                 f"{_SAME_WORDS}: in German that's about the same number of words.",
                 "Use Sie unless the interviewer uses du with you. Technical terms the way German-speaking engineers "
                 "say them (often the English word: API, Deployment, Cloud)."),
    LiveLanguage("pt", "Portuguese", "Português (Portuguese)", "pt", 1.6,
                 f"{_SAME_WORDS}: in Portuguese that's about 15% more words.",
                 "Use você, and the variety the interviewer speaks (Brazilian or European). Technical terms the way "
                 "Portuguese-speaking engineers say them (often the English word: API, backend, deploy)."),
    LiveLanguage("it", "Italian", "Italiano (Italian)", "it", 1.6,
                 f"{_SAME_WORDS}: in Italian that's about 15% more words.",
                 "Use Lei unless the interviewer uses tu with you. Technical terms the way Italian engineers say "
                 "them (often the English word: API, backend, cloud)."),
    LiveLanguage("nl", "Dutch", "Nederlands (Dutch)", "nl", 1.6,
                 f"{_SAME_WORDS}: in Dutch that's about the same number of words.",
                 "Use the form of address the interviewer uses with you (je or u). Technical terms the way Dutch "
                 "engineers say them (often the English word: API, backend, deployment)."),
    LiveLanguage("ja", "Japanese", "日本語 (Japanese)", "ja", 1.8,
                 "Length targets are counted in English words; in Japanese count about two characters per English "
                 "word (60–80 words is about 120–160 characters), keeping the same speaking time.",
                 "Polite spoken Japanese (です・ます), the way a candidate talks in a Japanese interview: natural, not "
                 "stiff written keigo. Technical terms as Japanese engineers say them (katakana or the English word: "
                 "API, データベース)."),
    LiveLanguage("ru", "Russian", "Русский (Russian)", "ru", 2.2,
                 f"{_SAME_WORDS}: in Russian that's about 10% fewer words.",
                 "Use вы. Technical terms the way Russian-speaking engineers say them (often the English word or "
                 "its common Russian form: API, бэкенд, деплой)."),
)}
AUTO = "auto"
AUTO_LABEL = "Auto-detect"
# The order the pickers offer them in (English first: the default).
ORDER = ("en", "hi", "hinglish", "es", "fr", "de", "pt", "it", "nl", "ja", "ru")
# The longest any language needs, for answers whose language isn't known in advance.
_MOST_TOKENS = max(lang.tokens for lang in LANGUAGES.values())


def available() -> list[str]:
    """The interview languages this server offers, in picker order ("auto" after English); ["en"] when it's off."""
    return ["en", AUTO, *ORDER[1:]] if get_settings().live_languages else ["en"]


def normalize(language: str | None) -> str:
    """The interview language a live session really gets: one this server offers, else English."""
    code = (language or "en").strip().lower()
    return code if code in available() else "en"


def known(language: str | None) -> str:
    """A language code the copilot knows, else English (no server setting involved: the engine's own check)."""
    code = (language or "en").strip().lower()
    return code if code == AUTO or code in LANGUAGES else "en"


def normalize_answer(answer: str | None, interview: str) -> str | None:
    """The stored answer language: None means "same as the interview" (also when it's the same anyway)."""
    code = (answer or "").strip().lower()
    if not code or code == interview or code not in LANGUAGES or code not in available():
        return None
    return code


def answer_code(answer: str | None, interview: str) -> str:
    """What answers are written in: the answer language, else the interview's ("auto": each question's own)."""
    return answer or interview


def is_english(interview: str, answer: str) -> bool:
    return interview == "en" and answer == "en"


def stt_language(interview: str) -> str:
    if interview == AUTO:
        return "multi"
    lang = LANGUAGES.get(interview)
    return lang.deepgram if lang else "en"


def token_factor(answer: str) -> float:
    if answer == AUTO:
        return _MOST_TOKENS
    lang = LANGUAGES.get(answer)
    return lang.tokens if lang else 1.0


def name(code: str) -> str:
    if code == AUTO:
        return "the interviewer's language"
    lang = LANGUAGES.get(code)
    return lang.name if lang else "English"


_FORMAT = ("Keep the section labels (GROUNDED:, ANSWER:, CODE:, POINTS: and the rest) exactly as they are, in English, "
           "and GROUNDED's value in English. Code, its identifiers and its comments stay in English; everything that "
           "is read or said (ANSWER, PROBLEM, EDGE, TRACE notes, TESTS descriptions, DESIGN lines, the TERMS "
           "meanings, FOLLOWUP and the POINTS labels) is in the answer language.")
_STYLE = ("The rules on how the answer sounds hold in this language too: answer first, plain everyday words, natural "
          "speech, no wrap-up, and none of the stiff, written or corporate phrasing the rules name in English, in "
          "its equivalents in this language.")


def answer_rule(answer: str, interview: str) -> str:
    """The prompt's language line, for any session that isn't English both ways (English keeps its old line)."""
    heard = (f" The interviewer speaks {name(interview)}: QUESTION and the conversation are in {name(interview)}, "
             "and may mix in English." if interview not in ("en", AUTO) else "")
    if answer == AUTO:
        return ("Answer language: the language the interviewer asked this QUESTION in (look at QUESTION and their "
                "latest turn): Spanish gets Spanish, Hindi gets Hindi in Devanagari, English gets English, and so on; "
                "a mix of Hindi and English gets Hinglish in Latin script. If you can't tell, English. Speak it the "
                "way a prepared professional speaks it in a job interview, with technical words as engineers say them "
                "there (often the English word), and the form of address the interviewer uses. Length targets "
                "are counted in English words; keep their speaking time (in Japanese, about two characters per "
                f"English word). {_FORMAT} {_STYLE}")
    lang = LANGUAGES.get(answer, LANGUAGES["en"])
    if lang.code == "en":
        return (f"Answer language: English.{heard} Answer in English anyway, in plain spoken English; keep names of "
                "people, companies and products as they were said.")
    return (f"Answer language: {lang.name}.{heard} Write the answer in natural spoken {lang.name}, the way a prepared "
            f"professional talks in a job interview. {lang.voice} {lang.length} {_FORMAT} {_STYLE}")


def classifier_note(interview: str) -> str:
    """Told to the question classifier in a session that isn't English (English's request is unchanged)."""
    spoken = "any of several languages" if interview == AUTO else f"{name(interview)}, possibly mixed with English"
    return (f"\nThe interview is in {spoken}. Judge the utterance in its own language, and write normalized_question "
            "in the language it was asked in.")


def report_rule(answer: str, interview: str) -> str:
    """Told to the review, for a session that isn't English both ways."""
    keys = ("Keep the JSON keys and scores exactly as specified. Grade the same rubric as in English; an answer is "
            "never marked down for the language it's given in, or for mixing in English.")
    if answer == AUTO:
        return ("\nThe interview may not be in English. Write every text value (summary, topics, follow-ups, weak "
                "areas, preparation, strengths, improvements, practice, feedback, missing_points, better) in the "
                "language most of the interview was in. " + keys)
    lang = LANGUAGES.get(answer, LANGUAGES["en"])
    script = " in Devanagari, keeping technical words in English" if lang.code == "hi" else (
        ", in Latin script" if lang.code == "hinglish" else "")
    heard = f" The interviewer spoke {name(interview)}." if interview not in ("en", AUTO, lang.code) else ""
    return (f"\nWrite every text value (summary, topics, follow-ups, weak areas, preparation, strengths, improvements, "
            f"practice, feedback, missing_points, better) in {lang.name}{script}.{heard} " + keys)


def follow_up_rule(answer: str, interview: str) -> str:
    """Told to the follow-up (debrief and thank-you email), for a session that isn't English both ways."""
    email = "the language most of the interview was in" if interview == AUTO else name(interview)
    debrief = "the language most of the interview was in" if answer == AUTO else name(answer)
    return (f"\nWrite the debrief in {debrief}, and the thank-you email in {email}, the language the interviewer "
            "used. Keep the JSON keys exactly as specified.")
