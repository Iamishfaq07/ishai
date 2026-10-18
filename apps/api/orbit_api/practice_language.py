"""Practice languages for mock interviews: English (the default), and Hindi and Hinglish behind ORBIT_MULTILINGUAL.

Only the mock interview changes language here: what the interviewer says, the transcription setting and the written
review. Live sessions have their own languages (live_language.py); the app's own labels stay English. The rubric is
the same in every language, and an answer is never marked down for the language it's given in.

Transcription: Deepgram documents Hindi in Nova-3's multilingual code-switching mode (`language=multi`), which is used
for both Hindi and Hinglish. Its quality on real Hinglish interview audio is for the owner to check before turning the
flag on.
"""

from __future__ import annotations

from typing import Literal

from orbit_api.config import get_settings

PracticeLanguage = Literal["en", "hi", "hinglish"]
LABELS: dict[str, str] = {"en": "English", "hi": "हिन्दी (Hindi)", "hinglish": "Hinglish"}


def available() -> list[str]:
    return ["en", "hi", "hinglish"] if get_settings().multilingual else ["en"]


def normalize(language: str | None, session_type: str | None) -> str:
    """The language a session really gets: a practice language for a mock while the flag is on, else English."""
    lang = (language or "en").strip().lower()
    if session_type != "mock" or lang not in available():
        return "en"
    return lang


def stt_language(language: str) -> str:
    return "multi" if language in ("hi", "hinglish") else "en"


_INTERVIEWER: dict[str, str] = {
    "hi": ("LANGUAGE: conduct the whole interview in Hindi, written in Devanagari script, the way an Indian "
           "interviewer speaks Hindi at work: keep common technical words and product names in English (API, "
           "database, deadline, Python). Use the respectful 'आप'. The candidate may answer in Hindi, English or a mix: "
           "that's fine, and never comment on their choice of language."),
    "hinglish": ("LANGUAGE: conduct the interview in Hinglish, the natural mix of Hindi and English Indian "
                 "professionals use at work, written in Latin script (Roman Hindi), for example 'Apne last project "
                 "ke baare mein bataiye, usme aapka role kya tha?'. Use the respectful 'aap'. The candidate may "
                 "answer in Hindi, English or a mix: that's fine, and never comment on their choice of language."),
}

_REPORT: dict[str, str] = {
    "hi": ("\nThe interview was in Hindi. Write every text value (summary, topics, follow-ups, weak areas, "
           "preparation, strengths, improvements, practice, top_practice, feedback, missing_points, improvement, "
           "the rubric's reasons, better) in Hindi, in Devanagari script, keeping technical words in English. A "
           "rubric quote stays exactly as the candidate said it, in their own words and script. Keep the JSON keys "
           "and scores exactly as specified. Grade the same rubric as in English; an answer in Hindi, English or a "
           "mix is never marked down for its language."),
    "hinglish": ("\nThe interview was in Hinglish. Write every text value (summary, topics, follow-ups, weak areas, "
                 "preparation, strengths, improvements, practice, top_practice, feedback, missing_points, "
                 "improvement, the rubric's reasons, better) in Hinglish, in Latin script, the way the candidate "
                 "spoke. A rubric quote stays exactly as the candidate said it. Keep the JSON keys and scores exactly "
                 "as specified. Grade the same rubric as in English; an answer in Hindi, English or a mix is never "
                 "marked down for its language."),
}


def interviewer_instruction(language: str) -> str:
    return _INTERVIEWER.get(language, "")


def report_instruction(language: str) -> str:
    return _REPORT.get(language, "")


# The same text costs more tokens in these languages (DeepSeek-V3's tokenizer on one review: Hindi in Devanagari about
# 2.2x English, Hinglish about 1.5x), so the interviewer's and the review's output budgets grow with them; a budget
# sized for English cuts a Hindi review's JSON off, and then there's no review at all.
_TOKEN_FACTOR: dict[str, float] = {"hi": 2.5, "hinglish": 1.6}
MAX_OUTPUT_TOKENS = 8_000


def max_tokens(english: int, language: str) -> int:
    """An output budget sized for English, for the round's language."""
    return min(MAX_OUTPUT_TOKENS, max(english, round(english * _TOKEN_FACTOR.get(language, 1.0))))


# A drill's lead lines (live/mock_interviewer._DRILL_LEAD, same keys), said in the round's language.
DRILL_LEAD: dict[str, dict[str, str]] = {
    "hi": {
        "first": "चलिए, आपके पिछले सेशन के कुछ सवालों पर काम करते हैं। ",
        "first_prep": "चलिए, आपकी तैयारी वाले सवालों का अभ्यास करते हैं। ",
        "first_story": "चलिए, आपकी एक कहानी सुनाने का अभ्यास करते हैं। ",
        "first_answer": "चलिए, आपके तैयार किए गए एक जवाब का अभ्यास करते हैं। ",
        "retry": "चलिए, इस सवाल को एक बार फिर से करते हैं। ",
        "concise": "अब यही जवाब छोटे में, लगभग तीस सेकंड में। ",
    },
    "hinglish": {
        "first": "Chaliye, aapke pichhle session ke kuch questions par kaam karte hain. ",
        "first_prep": "Chaliye, aapki preparation wale questions ki practice karte hain. ",
        "first_story": "Chaliye, aapki ek story sunane ki practice karte hain. ",
        "first_answer": "Chaliye, aapke prepared answers mein se ek ki practice karte hain. ",
        "retry": "Chaliye, is question ko ek baar phir try karte hain. ",
        "concise": "Ab yahi answer short mein, lagbhag tees second mein. ",
    },
}


# When the model can't be reached, the interviewer falls back to these (the English ones live with the interviewer).
FALLBACK_QUESTIONS: dict[str, list[str]] = {
    "hi": [
        "शुरुआत के लिए, अपने बारे में बताइए और अभी आप किस पर काम कर रहे हैं?",
        "किसी ऐसे प्रोजेक्ट के बारे में बताइए जिस पर आपको गर्व है। उसमें आपकी भूमिका क्या थी?",
        "कोई ऐसा समय बताइए जब किसी साथी से आपकी असहमति हुई। आपने उसे कैसे सुलझाया?",
        "जब सब कुछ एक साथ ज़रूरी लगे, तो आप कैसे तय करते हैं कि पहले क्या करना है?",
        "आप इस भूमिका में क्यों रुचि रखते हैं?",
        "क्या आप मुझसे कुछ पूछना चाहेंगे?",
    ],
    "hinglish": [
        "Shuru karte hain: apne background ke baare mein bataiye, aur abhi aap kis par kaam kar rahe hain?",
        "Kisi aise project ke baare mein bataiye jis par aapko proud feel hota hai. Usme aapka role kya tha?",
        "Ek time bataiye jab kisi teammate se aapka disagreement hua. Aapne use kaise handle kiya?",
        "Jab sab kuch urgent lage, tab aap kaise decide karte hain ki pehle kya karna hai?",
        "Aap is role mein interested kyun hain?",
        "Kya aap mujhse kuch poochna chahenge?",
    ],
}
FALLBACK_FOLLOW_UP: dict[str, str] = {
    "hi": "क्या आप इसे थोड़ा और ठोस बना सकते हैं? आपने खुद क्या किया, और नतीजा क्या रहा?",
    "hinglish": "Kya aap ise thoda aur concrete bana sakte hain? Aapne khud kya kiya, aur result kya raha?",
}
