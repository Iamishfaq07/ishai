"""Reading live interview speech in the session's language (DECISIONS D62).

A session's `Speech` is how the finalizer, the deduplicator and the engine read what the interviewer says: whether
it's a question, whether it's finished, what belongs to it, and how big an answer it wants.

- `ENGLISH` is question_detector.py and routing.py themselves, unchanged: every method hands the text straight to
  them, so an English session reads speech exactly as it always did.
- `MultiSpeech` serves the other languages. Each line is read in its own language: a session in Spanish still hears
  "Tell me about yourself." in English (interviewers switch, and Indian interviews mix Hindi and English all the
  time), so a line that reads as English goes to question_detector as is, and anything else is judged with that
  language's cue words (live/language_cues.py) and the same scores the English detector uses. What the cues can't
  call but still looks like a question (a question mark, a question word) lands in the uncertain band, where the
  model-backed classifier decides, as in English.

Text is folded before matching (case, accents on Latin letters, "ё", the Devanagari nukta), and split into words
with the Devanagari vowel signs kept (Python's \\w alone cuts "क्या" in two). Japanese has no spaces: its words are
approximated by script runs (kanji, hiragana, katakana), which is enough for counting and comparing; its cues are
matched as substrings.
"""

import re
import unicodedata
from dataclasses import dataclass, replace
from functools import cache, lru_cache

from orbit_api.live import question_detector as qd
from orbit_api.live import routing
from orbit_api.live.events import AnswerSize, QuestionType, Speaker
from orbit_api.live.language_cues import ALL, RawCues

# Letters, digits and the Devanagari block's vowel signs and viramas (not its dandas, U+0964/5, which end sentences).
_WORD = re.compile(r"(?:[^\W_]|[̀-ͯऀ-ॣ०-ॿ])+")
# A sentence ends at . ? ! … followed by a space, or at a Japanese or Devanagari full stop even without one.
_SENTENCE = re.compile(r"(?<=[.?!…])\s+|(?<=[。？！।॥])\s*")
_END_MARK = re.compile(r"[.?!…。？！।॥][\"'”’»」』)\]]*$")
_QUESTION_MARK = re.compile(r"[?？][\"'”’»」』)\]]*$")
MAX_CONTEXT_WORDS = qd.MAX_CONTEXT_WORDS
MAX_PARTS = qd.MAX_PARTS
# English words that mark a line as English when telling a line's language (beside each language's own markers).
# Not the words other languages share or borrow ("me", "in", "was", "will", "has", "okay", "good").
_EN_MARKERS = frozenset((
    "the you your what how why and are does did can could would should tell about of with this that have i it my "
    "for at be were which when where who there they or if yourself walk through describe explain let's lets please "
    "just been any some our their"
).split())
# Japanese words that contain a question word without asking anything ("どうぞ" has "どう", "いつも" has "いつ").
_JA_FALSE_WH = ("どうしても", "どうぞ", "どうも", "いつも", "何でも", "なんでも", "どこでも", "いつでも", "誰でも")
_TYPE_ORDER: tuple[QuestionType, ...] = (
    QuestionType.salary, QuestionType.clarification, QuestionType.coding, QuestionType.system_design,
    QuestionType.resume, QuestionType.behavioral, QuestionType.leadership, QuestionType.culture,
)


# ---- folding and words ---------------------------------------------------------------------------------------------

def fold(text: str, keep: str = "") -> str:
    """Lowercase, NFKC (full-width "？" is "?"), no accents on Latin letters (except those in `keep`), "ё" as "е",
    "ß" as "ss", no Devanagari nukta and chandrabindu as anusvara (spelling variants of the same word)."""
    text = unicodedata.normalize("NFKC", text).lower().replace("ß", "ss").replace("’", "'").replace("ё", "е")
    out: list[str] = []
    for ch in text:
        if ch in keep:
            out.append(ch)
            continue
        if ch == "़":
            continue
        if ch == "ँ":
            out.append("ं")
            continue
        decomposed = unicodedata.normalize("NFD", ch)
        if len(decomposed) > 1 and decomposed[0].isascii():
            out.append(decomposed[0])  # é → e, ñ → n (but й, the Devanagari vowel signs, kana: as they are)
        else:
            out.append(ch.replace("़", "") if len(decomposed) > 1 else ch)
    return "".join(out)


def _kind(ch: str) -> str:
    o = ord(ch)
    if 0x3040 <= o <= 0x309F:
        return "hiragana"
    if 0x30A0 <= o <= 0x30FF or 0x31F0 <= o <= 0x31FF:
        return "katakana"
    if 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or o in (0x3005, 0x3006):
        return "kanji"
    return "other"


def _segment(word: str) -> list[str]:
    """A run of Japanese split where the script changes ("自己紹介をしてください" → 自己紹介 | をしてください): about
    one piece per word, which is what counting and comparing need."""
    if all(_kind(c) == "other" for c in word):
        return [word]
    out: list[str] = []
    cur, kind = "", ""
    for c in word:
        k = _kind(c)
        if cur and k != kind:
            out.append(cur)
            cur = ""
        cur += c
        kind = k
    if cur:
        out.append(cur)
    return out


def words(folded: str) -> list[str]:
    return [piece for w in _WORD.findall(folded) for piece in _segment(w)]


def sentences(text: str) -> list[str]:
    return [x.strip() for x in _SENTENCE.split(text.strip()) if x.strip()]


def join(parts: list[str]) -> str:
    """Sentences back into one text: a space between them, none after a Japanese full stop ("…ます。では…")."""
    out = ""
    for part in parts:
        out += part if not out or out.endswith(("。", "？", "！")) else " " + part
    return out


# ---- cue tables, compiled ------------------------------------------------------------------------------------------

class Phrases:
    """A set of cue phrases, matched on word lists (a trailing "*" on a word is a prefix) or, for Japanese, on the
    text with its spaces and punctuation removed."""

    def __init__(self, raw: str, cues: RawCues) -> None:
        entries = [e.strip() for e in raw.split("|") if e.strip()]
        self.seqs: list[tuple[str, ...]] = []
        self.texts: tuple[str, ...] = ()
        compact: set[str] = set()
        for e in entries:
            folded = fold(e, cues.keep)
            seq: list[str] = []
            for chunk in folded.split():
                toks = _WORD.findall(chunk)
                if toks and chunk.endswith("*"):
                    toks[-1] += "*"
                seq += toks
            if seq:
                self.seqs.append(tuple(seq))
            compact.add("".join(_WORD.findall(folded)))
        self.texts = tuple(sorted((c for c in compact if c), key=len, reverse=True))
        self.whole = {" ".join(s).replace("*", "") for s in self.seqs}
        self._by_first: dict[str, list[tuple[str, ...]]] = {}
        self._wild: list[tuple[str, ...]] = []
        for s in self.seqs:
            (self._wild if s[0].endswith("*") else self._by_first.setdefault(s[0], [])).append(s)
        self.words = frozenset(s[0] for s in self.seqs if len(s) == 1 and not s[0].endswith("*"))

    def __bool__(self) -> bool:
        return bool(self.seqs)

    @staticmethod
    def _fits(toks: list[str], i: int, seq: tuple[str, ...]) -> bool:
        if i + len(seq) > len(toks):
            return False
        for j, p in enumerate(seq):
            t = toks[i + j]
            if not (t.startswith(p[:-1]) if p.endswith("*") else t == p):
                return False
        return True

    def at(self, toks: list[str], i: int) -> int:
        """The length of the longest phrase starting at word i (0: none)."""
        if i >= len(toks):
            return 0
        best = 0
        for seq in (*self._by_first.get(toks[i], ()), *self._wild):
            if len(seq) > best and self._fits(toks, i, seq):
                best = len(seq)
        return best

    def starts(self, toks: list[str]) -> bool:
        return self.at(toks, 0) > 0

    def contains(self, toks: list[str]) -> bool:
        return any(self.at(toks, i) for i in range(len(toks)))

    def first_at(self, toks: list[str], within: int) -> bool:
        return any(self.at(toks, i) for i in range(min(within, len(toks))))

    def in_text(self, text: str) -> bool:
        return any(p in text for p in self.texts)

    def text_starts(self, text: str) -> bool:
        return any(text.startswith(p) for p in self.texts)

    def text_ends(self, text: str) -> bool:
        return any(text.endswith(p) for p in self.texts)

    def strip_front(self, text: str) -> str:
        """Japanese: drop these phrases from the front, as many times as they come ("はい、では、…")."""
        changed = True
        while changed and text:
            changed = False
            for p in self.texts:
                if text.startswith(p) and len(text) > len(p):
                    text, changed = text[len(p):], True
                    break
        return text

    def only_these(self, text: str) -> bool:
        """Japanese: the text is nothing but these phrases ("はいわかりましたありがとうございます")."""
        while text:
            for p in self.texts:
                if text.startswith(p):
                    text = text[len(p):]
                    break
            else:
                return False
        return True


@dataclass(frozen=True)
class _Read:
    """One line, ready to match."""

    raw: str
    toks: list[str]  # folded words (Japanese: script runs)
    text: str  # Japanese: the folded text without spaces or punctuation
    marked: frozenset[str]  # lowercased words as written, accents kept (Spanish "cómo")
    qmark: bool


class Cues:
    """One language's cue tables, compiled."""

    def __init__(self, raw: RawCues) -> None:
        self.raw = raw
        self.code = raw.code
        self.japanese = raw.script == "japanese"
        self.sov = raw.sov
        names = ("wh", "aux", "particle", "endings", "request", "indirect", "open_floor", "fillers", "filler_words",
                 "lead_fillers", "continuers", "follow_up", "trailing", "trailing_endings", "clause_breaks", "openers",
                 "new_topic", "lead_in", "check_ins", "logistics", "asides", "reassurance", "pleasantries",
                 "reaction", "backchannel", "markers")
        for name in names:
            setattr(self, name, Phrases(getattr(raw, name), raw))
        self.wh_marked = frozenset(unicodedata.normalize("NFC", w.strip().lower())
                                   for w in raw.wh_marked.split("|") if w.strip())
        self.types = {QuestionType(k): Phrases(v, raw) for k, v in raw.types.items() if k != "story"}
        self.story = Phrases(raw.types.get("story", ""), raw)
        self.size = {k: Phrases(v, raw) for k, v in raw.size.items()}

    # (attributes set in __init__ above; declared for type checkers)
    wh: Phrases
    aux: Phrases
    particle: Phrases
    endings: Phrases
    request: Phrases
    indirect: Phrases
    open_floor: Phrases
    fillers: Phrases
    filler_words: Phrases
    lead_fillers: Phrases
    continuers: Phrases
    follow_up: Phrases
    trailing: Phrases
    trailing_endings: Phrases
    clause_breaks: Phrases
    openers: Phrases
    new_topic: Phrases
    lead_in: Phrases
    check_ins: Phrases
    logistics: Phrases
    asides: Phrases
    reassurance: Phrases
    pleasantries: Phrases
    reaction: Phrases
    backchannel: Phrases
    markers: Phrases

    def read(self, text: str) -> _Read:
        raw = text.strip()
        folded = fold(raw, self.raw.keep)
        toks = words(folded)
        marked = frozenset(_WORD.findall(unicodedata.normalize("NFC", raw).lower())) if self.wh_marked else frozenset()
        compact = "".join(toks) if self.japanese else ""
        # A Japanese question ends in か (ですか, ますか, でしょうか) whether or not a question mark was written.
        qmark = (bool(_QUESTION_MARK.search(raw)) or raw.startswith("¿")
                 or (self.japanese and self.endings.text_ends(compact)))
        return _Read(raw, toks, compact, marked, qmark)

    def has(self, phrases: Phrases, r: _Read) -> bool:
        return phrases.in_text(r.text) if self.japanese else phrases.contains(r.toks)

    def opens(self, phrases: Phrases, r: _Read) -> bool:
        """At the start, after openers and fillers ("Bueno, pasemos a…", "では、次の質問です")."""
        if self.japanese:
            return phrases.text_starts(self.openers.strip_front(self.lead_fillers.strip_front(r.text)))
        toks = self.without_openers(r.toks)
        return phrases.starts(toks)

    def without_openers(self, toks: list[str]) -> list[str]:
        i = 0
        while i < len(toks) - 1 and (toks[i] in self.openers.words or toks[i] in self.lead_fillers.words):
            i += 1
        return toks[i:]

    def clauses(self, toks: list[str]) -> list[list[str]]:
        out: list[list[str]] = [[]]
        for t in toks:
            if t in self.clause_breaks.words:
                out.append([])
            else:
                out[-1].append(t)
        return [c for c in out if c]

    def at_clause_start(self, phrases: Phrases, r: _Read, within: int = 1) -> bool:
        return any(phrases.first_at(self.without_openers(c), within) for c in self.clauses(r.toks))

    def count(self, r: _Read) -> int:
        return len(r.toks)

    def filler_only(self, r: _Read) -> bool:
        if self.japanese:
            return self.fillers.only_these(r.text)
        # Up to four filler words ("d'accord, très bien" is four), where English allows three.
        return (" ".join(r.toks) in self.fillers.whole
                or (len(r.toks) <= 4 and all(t in self.filler_words.words for t in r.toks)))


@cache
def cues(code: str) -> Cues:
    return Cues(ALL[code])


# ---- which language a line is in -----------------------------------------------------------------------------------

def _scripts(text: str) -> set[str]:
    found: set[str] = set()
    for ch in text:
        o = ord(ch)
        if 0x0900 <= o <= 0x097F:
            found.add("devanagari")
        elif 0x0400 <= o <= 0x04FF:
            found.add("cyrillic")
        elif 0x3040 <= o <= 0x30FF or 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF:
            found.add("japanese")
    return found


@lru_cache(maxsize=8192)
def language_of(text: str, langs: tuple[str, ...], primary: str) -> str:
    """The language a line is in: one of `langs` or "en". Script first (Devanagari is Hindi, kana and kanji
    Japanese, Cyrillic Russian), then, for Latin script, which language's common words it has most of. A tie goes to
    the session's own language when it uses Latin script (a session in Spanish reading "¿Y la base de datos?") and to
    English otherwise."""
    scripts = _scripts(text)
    for lang in langs:
        if ALL[lang].script in scripts:
            return lang
    latin = sorted((lang for lang in langs if ALL[lang].script == "latin"), key=lambda lang: lang != primary)
    if not latin:
        return "en"
    toks = _WORD.findall(fold(text))
    english = sum(t in _EN_MARKERS for t in toks)
    best, score = latin[0], -1
    for lang in latin:
        markers = cues(lang).markers.words
        n = sum(t in markers for t in toks)
        if n > score:
            best, score = lang, n
    if score > english or (score == english and best == primary):
        return best
    return "en"


# ---- the readers ---------------------------------------------------------------------------------------------------

class Speech:
    """English: question_detector and routing, exactly. The base for MultiSpeech."""

    code = "en"
    english = True
    filler_words: frozenset[str] = frozenset()

    def lang(self, text: str) -> str:
        """The language a line is in."""
        return "en"

    def detect(self, text: str, speaker: Speaker, ctx: qd.DetectorContext | None = None) -> qd.Detection:
        return qd.detect(text, speaker, ctx)

    def is_complete(self, text: str) -> bool:
        return qd.is_complete(text)

    def lead_in(self, text: str, max_words: int) -> str:
        return qd.lead_in(text, max_words)

    def continue_question(self, question: str, more: str) -> str:
        return qd.continue_question(question, more)

    def starts_new_topic(self, text: str) -> bool:
        return qd.starts_new_topic(text)

    def tokens(self, text: str) -> list[str]:
        return qd.tokens(text)

    def classify_type(self, text: str) -> QuestionType:
        return qd.classify_type(qd.normalize(text))

    def question_parts(self, question: str) -> list[str]:
        return qd.question_parts(question)

    def pick_size(self, question: str, qtype: QuestionType, parts: int = 1) -> AnswerSize:
        return routing.pick_size(question, qtype, parts)

    def answer_words(self, text: str) -> list[str]:
        return qd.tokens(text)

    def broad_background(self, question: str) -> bool:
        """"Tell me about yourself" in the session's language (English has its own regex in context_builder)."""
        return False

    def project_ask(self, question: str) -> bool:
        return False


ENGLISH = Speech()


class MultiSpeech(Speech):
    english = False

    def __init__(self, code: str, langs: tuple[str, ...]) -> None:
        self.code = code
        self.langs = langs
        self.primary = code if code in ALL else langs[0]
        self.filler_words = frozenset(w for lang in langs for w in cues(lang).filler_words.words)

    def lang(self, text: str) -> str:
        return language_of(text, self.langs, self.primary if self.code != "auto" else "")

    # ---- detection ----------------------------------------------------------------------------------------------

    def detect(self, text: str, speaker: Speaker, ctx: qd.DetectorContext | None = None) -> qd.Detection:
        ctx = ctx or qd.DetectorContext()
        english = qd.detect(text, speaker, ctx)
        if self.lang(text) == "en":
            return english
        own = self._detect(text, speaker, ctx)
        # The line's own reading wins, unless it's small talk by its cues ("¿Me escuchas?") and English, which can
        # only see a question mark and a few borrowed words, isn't sure it's a question either.
        if own.question_type is QuestionType.small_talk and english.confidence < 0.6:
            return own
        return own if own.confidence >= english.confidence else english

    def _detect(self, text: str, speaker: Speaker, ctx: qd.DetectorContext) -> qd.Detection:
        core = self._extract_question(text)
        d = self._detect_one(core, speaker, ctx)
        if speaker != "interviewer":
            return d
        full = self._question_in_context(text)
        if full == core:
            return d
        qtype = d.question_type
        if qtype is QuestionType.technical:
            qtype = self.classify_type(full)
        return replace(d, question_text=full, question_type=qtype)

    def _detect_one(self, text: str, speaker: Speaker, ctx: qd.DetectorContext | None = None) -> qd.Detection:
        ctx = ctx or qd.DetectorContext()
        lang = self.lang(text)
        if lang == "en":
            return qd._detect_one(text, speaker, ctx)
        c = cues(lang)
        r = c.read(text)
        reasons: list[str] = []

        def result(conf: float, qtype: QuestionType, **kw: object) -> qd.Detection:
            complete = self._complete(r, c)
            conf = max(0.0, min(1.0, conf))
            is_q = conf >= 0.5 and qtype not in (QuestionType.non_question, QuestionType.small_talk)
            d = qd.Detection(is_question=is_q, confidence=conf, question_text=r.raw, question_type=qtype,
                             is_complete=complete, reasons=reasons, **kw)  # type: ignore[arg-type]
            d.should_generate = is_q and complete and conf >= 0.6
            d.needs_llm = 0.35 <= conf < 0.6 and complete
            return d

        if not r.toks:
            return result(0.0, QuestionType.non_question)
        if speaker not in ("interviewer", "other"):
            reasons.append("speaker_not_interviewer")
            return result(0.0, QuestionType.non_question)

        recent_question = bool(ctx.previous_question) and (ctx.seconds_since_previous_answer or 0) < 600
        if c.japanese:
            core_text = c.lead_fillers.strip_front(r.text)
            continuer = core_text in c.continuers.texts
        else:
            core = r.toks
            while len(core) > 1 and core[0] in c.lead_fillers.words:
                core = core[1:]
            continuer = " ".join(core) in c.continuers.whole
        if recent_question and continuer:
            reasons.append("continuer_after_question")
            return result(0.7, QuestionType.follow_up, is_follow_up=True)
        if c.filler_only(r):
            reasons.append("filler")
            return result(0.02, QuestionType.small_talk)
        if c.has(c.logistics, r):
            reasons.append("call_logistics")
            return result(0.05, QuestionType.small_talk)
        n = c.count(r)
        if n <= (12 if c.japanese else 9) and c.has(c.check_ins, r):
            reasons.append("check_in")
            return result(0.05, QuestionType.small_talk)

        score = 0.0
        if r.qmark:
            score += 0.45
            reasons.append("question_mark")
        wh = self._wh(r, c)
        if wh >= 0.4:
            score += wh
            reasons.append("wh_word")
        elif self._yes_no(r, c):
            score += 0.3
            reasons.append("aux_inversion")
        elif wh:
            score += wh
            reasons.append("embedded_question_word")
        request = self._request(r, c)
        if request:
            score += request
            reasons.append("imperative_request" if request >= 0.6 else "possible_request")
        if c.has(c.indirect, r):
            score += 0.55
            reasons.append("indirect_request")
        if c.has(c.open_floor, r):
            score += 0.3
            reasons.append("open_floor")
        if n < 3 and request < 0.6:
            score -= 0.25
            reasons.append("very_short")
        if n >= 6:
            score += 0.05

        qtype = self._classify(r, c, text)
        if qtype is not QuestionType.technical:
            score += 0.1
        if qtype is QuestionType.coding and qd._CODING_PROMPT.search(qd.normalize(text)):
            score += 0.5
            reasons.append("coding_prompt")

        follow_up = False
        if recent_question and n <= 14 and c.has(c.follow_up, r):
            follow_up = True
            reasons.append("follow_up_reference")
            if r.qmark:
                score += 0.2
            if qtype is QuestionType.technical:
                qtype = QuestionType.follow_up

        if ctx.session_type == "mock":
            score = 0.0
            reasons.append("mock_mode")
        return result(score, qtype, is_follow_up=follow_up)

    def _wh(self, r: _Read, c: Cues) -> float:
        """0.4: a question word where it asks; 0.2: one further into the sentence ("…erklären, wie das geht")."""
        if c.japanese:
            text = r.text
            for false in _JA_FALSE_WH:
                text = text.replace(false, "")
            return 0.4 if c.wh.in_text(text) else 0.0
        if c.sov:
            # Hindi's question words (क्या, कैसे, कब, kya, kaise) ask; its relative clauses use others (जो, जब).
            return 0.5 if c.wh.contains(r.toks) else 0.0
        if c.wh_marked and r.marked & c.wh_marked:
            return 0.4  # Spanish "cómo"/"qué": written with the accent only when they ask
        if c.at_clause_start(c.wh, r, within=3) and (r.qmark or not c.raw.wh_needs_mark):
            return 0.4
        return 0.2 if c.wh.contains(r.toks) and not c.raw.wh_needs_mark else 0.0

    def _yes_no(self, r: _Read, c: Cues) -> bool:
        if c.japanese:
            return c.endings.text_ends(r.text)
        if c.particle and any(t in c.particle.words for t in r.toks[:4]):
            return True
        return bool(c.aux) and c.at_clause_start(c.aux, r)

    def _request(self, r: _Read, c: Cues) -> float:
        if c.japanese or c.sov:
            return 0.6 if c.has(c.request, r) else 0.0
        if c.at_clause_start(c.request, r):
            return 0.6
        return 0.3 if c.request.contains(r.toks) else 0.0

    def _complete(self, r: _Read, c: Cues) -> bool:
        stripped = r.raw.strip()
        if not stripped:
            return False
        if _END_MARK.search(stripped):
            return True
        if not r.toks:
            return False
        if c.japanese:
            return not c.trailing_endings.text_ends(r.text) or c.request.text_ends(r.text)
        last = r.toks[-1]
        return last not in c.trailing.words and last not in qd._TRAILING

    def _classify(self, r: _Read, c: Cues, text: str) -> QuestionType:
        if c.has(c.story, r):
            return QuestionType.behavioral
        for qtype in _TYPE_ORDER:
            phrases = c.types.get(qtype)
            if phrases and c.has(phrases, r):
                return qtype
        # English words in the line ("linked list", "system design", "notice period") still say what it's about.
        return qd.classify_type(qd.normalize(text))

    # ---- sentences -----------------------------------------------------------------------------------------------

    def _noise(self, sentence: str) -> bool:
        lang = self.lang(sentence)
        if lang == "en":
            return qd._is_noise(sentence)
        c = cues(lang)
        r = c.read(sentence)
        if not r.toks or c.filler_only(r):
            return True
        pleasantry = c.opens(c.pleasantries, r)
        reassurance = c.count(r) <= 10 and c.has(c.reassurance, r)
        return (pleasantry or reassurance) and not self._detect_one(sentence, "interviewer").is_question

    def _reaction(self, sentence: str) -> bool:
        lang = self.lang(sentence)
        if lang == "en":
            return qd._is_reaction(sentence)
        c = cues(lang)
        r = c.read(sentence)
        return c.count(r) <= 8 and c.opens(c.reaction, r) and not self._detect_one(sentence, "interviewer").is_question

    def _framing(self, sentence: str) -> bool:
        lang = self.lang(sentence)
        if lang == "en":
            return qd._is_lead_in(sentence)
        c = cues(lang)
        r = c.read(sentence)
        return c.opens(c.lead_in, r) or c.opens(c.new_topic, r)

    def _aside(self, sentence: str) -> bool:
        lang = self.lang(sentence)
        if lang == "en":
            return qd._is_aside(sentence)
        c = cues(lang)
        r = c.read(sentence)
        return ((c.has(c.asides, r) or c.has(c.logistics, r))
                and not self._detect_one(sentence, "interviewer").is_question)

    def _count(self, text: str) -> int:
        return len(words(fold(text)))

    def _span(self, parts: list[str]) -> int | None:
        for i in range(len(parts) - 1, -1, -1):
            if not self._noise(parts[i]) and self._detect_one(parts[i], "interviewer").is_question:
                return i
        return None

    def _extract_question(self, text: str) -> str:
        raw = text.strip()
        parts = sentences(raw)
        if len(parts) <= 1:
            return raw
        i = self._span(parts)
        if i is not None:
            return parts[i]
        kept = [x for x in parts if not self._noise(x)]
        return join(kept) if kept else parts[-1]

    def _question_in_context(self, text: str) -> str:
        """The question sentence with what frames it in the same turn: up to two sentences of set-up right before it
        (more only if they're questions or framing too), and up to two sentences of constraints after."""
        parts = sentences(text)
        i = self._span(parts) if len(parts) > 1 else None
        if i is None:
            return self._extract_question(text)
        before: list[str] = []
        total = 0
        for j in range(i - 1, -1, -1):
            sentence = parts[j]
            if self._reaction(sentence):
                break
            if self._noise(sentence):
                continue
            size = self._count(sentence)
            if total + size > MAX_CONTEXT_WORDS:
                break
            if len(before) >= 2 and not (self._detect_one(sentence, "interviewer").is_question
                                         or self._framing(sentence)):
                break
            before.insert(0, sentence)
            total += size
        after: list[str] = []
        for sentence in parts[i + 1:]:
            if (len(after) >= 2 or self._noise(sentence) or self._count(sentence) < 3 or self._reaction(sentence)
                    or self._aside(sentence)):
                break
            after.append(sentence)
        return join([*before, parts[i], *after])

    # ---- the Speech interface ------------------------------------------------------------------------------------

    def is_complete(self, text: str) -> bool:
        lang = self.lang(text)
        if lang == "en":
            return qd.is_complete(text)
        c = cues(lang)
        return self._complete(c.read(text), c)

    def lead_in(self, text: str, max_words: int) -> str:
        if self.lang(text) == "en":
            return qd.lead_in(text, max_words)

        def keep(x: str) -> bool:
            if self._noise(x):
                return False
            if self._detect_one(x, "interviewer").is_question:
                return True
            return self._count(x) > 3 and not (self._reaction(x) and not self._framing(x)) and not self._aside(x)

        kept = [x for x in sentences(text) if keep(x)]
        while kept and sum(self._count(x) for x in kept) > max_words:
            kept.pop(0)
        return join(kept)

    def continue_question(self, question: str, more: str) -> str:
        if self.lang(more) == "en":
            return qd.continue_question(question, more)
        kept = [x for x in sentences(more) if not self._noise(x) and not self._aside(x)]
        return join([question.strip(), *kept]).strip()

    def starts_new_topic(self, text: str) -> bool:
        for sentence in sentences(text):
            lang = self.lang(sentence)
            if lang == "en":
                if qd.starts_new_topic(sentence):
                    return True
            else:
                c = cues(lang)
                if c.opens(c.new_topic, c.read(sentence)):
                    return True
            if not self._noise(sentence):
                return False
        return False

    def tokens(self, text: str) -> list[str]:
        return qd.tokens(text) if self.lang(text) == "en" else words(fold(text))

    def classify_type(self, text: str) -> QuestionType:
        lang = self.lang(text)
        if lang == "en":
            return qd.classify_type(qd.normalize(text))
        c = cues(lang)
        return self._classify(c.read(text), c, text)

    def question_parts(self, question: str) -> list[str]:
        if self.lang(question) == "en":
            return qd.question_parts(question)
        parts: list[str] = []
        for sentence in sentences(question):
            lang = self.lang(sentence)
            if lang == "en":
                if not qd._is_noise(sentence) and qd._detect_one(sentence, "interviewer").is_question:
                    parts.append(sentence)
                continue
            c = cues(lang)
            if self._noise(sentence):
                continue
            if self._detect_one(sentence, "interviewer").is_question or c.has(c.indirect, c.read(sentence)):
                parts.append(sentence)
        return parts[:MAX_PARTS] if len(parts) > 1 else [question.strip()]

    def pick_size(self, question: str, qtype: QuestionType, parts: int = 1) -> AnswerSize:
        """routing.pick_size, with the size cues in the question's own language."""
        lang = self.lang(question)
        if lang == "en":
            return routing.pick_size(question, qtype, parts)
        c = cues(lang)
        r = c.read(question)
        n = c.count(r)
        size = self._base_size(r, c, n, qtype)
        technical = qtype in (QuestionType.technical, QuestionType.system_design, QuestionType.follow_up)

        def cue(name: str) -> bool:
            phrases = c.size.get(name)
            return bool(phrases) and c.has(phrases, r)  # type: ignore[arg-type]

        if cue("brief"):
            return "brief"
        if cue("short"):
            return routing._at_most(size, "short")
        if cue("deep") and qtype != QuestionType.coding and not cue("intro"):
            size = routing._at_least(size, "detailed" if technical else routing.step_size(size, 1))
        if parts >= 3:
            size = routing._at_least(size, "detailed" if technical else "long")
        elif parts == 2:
            size = routing.step_size(routing._at_least(size, "short"), 1)
        if technical and n >= 35:
            size = routing._at_least(size, "long")
        if technical and routing.estimate_complexity(question) >= 0.6:
            size = routing._at_least(size, "detailed")
        return size

    def _base_size(self, r: _Read, c: Cues, n: int, qtype: QuestionType) -> AnswerSize:
        def cue(name: str) -> bool:
            phrases = c.size.get(name)
            return bool(phrases) and c.has(phrases, r)  # type: ignore[arg-type]

        short_q = n <= 12
        story = c.has(c.story, r)
        if qtype == QuestionType.coding:
            return "medium"
        if qtype == QuestionType.small_talk:
            return "brief"
        if qtype == QuestionType.clarification:
            return "short"
        if qtype == QuestionType.salary:
            return "brief" if cue("logistics") else "short"
        if qtype == QuestionType.culture:
            return "short" if cue("open_floor") else "medium"
        if qtype in (QuestionType.behavioral, QuestionType.leadership):
            return "long" if story or cue("project") else "medium"
        if qtype == QuestionType.resume:
            if cue("intro"):
                return "medium"
            if cue("project"):
                return "long"
            if cue("experience") and short_q:
                return "brief"
            return "medium"
        if cue("logistics"):
            return "brief"
        if cue("define") and short_q and not cue("approach"):
            return "short"
        if cue("compare"):
            return "short" if n <= 14 else "medium"
        if self._yes_no(r, c) and not self._wh(r, c) and short_q and not cue("explain"):
            return "brief"
        if qtype == QuestionType.system_design:
            return "detailed"
        if qtype == QuestionType.follow_up:
            return "medium" if cue("approach") or cue("explain") else "short"
        if cue("approach"):
            return "long"
        return "medium"

    def answer_words(self, text: str) -> list[str]:
        """The candidate's words minus what a listener says ("sí, claro", "はい、なるほど"); English backchannels are
        taken out by the finalizer."""
        lang = self.lang(text)
        if lang == "en":
            return qd.tokens(text)
        c = cues(lang)
        r = c.read(text)
        if c.japanese:
            rest = r.text
            for p in c.backchannel.texts:
                rest = rest.replace(p, " ")
            return words(rest)
        out: list[str] = []
        i = 0
        while i < len(r.toks):
            n = c.backchannel.at(r.toks, i)
            if n:
                i += n
            else:
                out.append(r.toks[i])
                i += 1
        return out

    def broad_background(self, question: str) -> bool:
        lang = self.lang(question)
        if lang == "en":
            return False
        c = cues(lang)
        intro = c.size.get("intro")
        return bool(intro) and c.has(intro, c.read(question))  # type: ignore[arg-type]

    def project_ask(self, question: str) -> bool:
        lang = self.lang(question)
        if lang == "en":
            return False
        c = cues(lang)
        project = c.size.get("project")
        return bool(project) and c.has(project, c.read(question))  # type: ignore[arg-type]


# The languages each session language reads (always with English beside them). Hindi and Hinglish read each other:
# the same interview comes out in Devanagari, in Latin script, or both.
_READS: dict[str, tuple[str, ...]] = {
    "auto": ("hi", "hinglish", "es", "fr", "de", "pt", "it", "nl", "ja", "ru"),
    "hi": ("hi", "hinglish"),
    "hinglish": ("hinglish", "hi"),
}


@cache
def speech_for(language: str | None) -> Speech:
    """The reader for a session language ("en", "auto", "es", …). English, and anything unknown, is ENGLISH."""
    code = (language or "en").strip().lower()
    if code == "auto" or code in ALL:
        return MultiSpeech(code, _READS.get(code, (code,)))
    return ENGLISH
