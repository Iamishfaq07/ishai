"""Live sessions in other languages (orbit_api/live_language.py, live/multilingual.py, DECISIONS D62).

English stays the default and reads exactly as before (the regression tests at the end). Another language is
stored on the session and its saved setup, picks Deepgram's language, is read for questions with its own cue words,
gets answers, a review and a follow-up written in the answer language, and token budgets that fit its script.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api import live_language
from orbit_api.config import get_settings
from orbit_api.live import classifier
from orbit_api.live import question_detector as qd
from orbit_api.live.answer_format import AnswerStreamParser, humanize_in, trim_cut_off
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.dedup import DedupDecision, Deduplicator
from orbit_api.live.engine import LiveEngine, SessionProfile
from orbit_api.live.events import LiveAnswer, LiveSettings, QuestionType
from orbit_api.live.finalizer import QuestionFinalizer
from orbit_api.live.multilingual import ENGLISH, fold, language_of, speech_for, words
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import STTConfig, STTSession, TranscriptEvent
from orbit_api.providers.stt.deepgram import build_url
from orbit_api.providers.stt.mock import MockSTTProvider, MockSTTSession
from orbit_api.retrieval.index import SessionIndex
from orbit_api.sessions.delivery import delivery_stats
from tests.test_api import _register
from tests.test_engine import Sink
from tests.test_question_quality import AFTER_QUESTION, FRESH, MUST_ANSWER, MUST_NOT

LANGS = ("hi", "hinglish", "es", "fr", "de", "pt", "it", "nl", "ja", "ru")


@pytest.fixture
def languages_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "live_languages", False)


def _session(client: TestClient, h: dict[str, str], **body: Any) -> dict[str, Any]:
    r = client.post("/v1/sessions", headers=h, json={"title": "Round 1", **body})
    assert r.status_code == 201, r.text
    out: dict[str, Any] = r.json()
    return out


# ---- what's offered and stored -------------------------------------------------------------------------------------

def test_the_server_offers_the_languages_english_first(client: TestClient) -> None:
    h = _register(client)
    offered = client.get("/v1/auth/me", headers=h).json()["live_languages"]
    assert offered == ["en", "auto", "hi", "hinglish", "es", "fr", "de", "pt", "it", "nl", "ja", "ru"]
    assert set(offered) - {"auto"} == set(live_language.LANGUAGES)


@pytest.mark.usefixtures("languages_off")
def test_switched_off_everything_is_english(client: TestClient) -> None:
    h = _register(client)
    assert client.get("/v1/auth/me", headers=h).json()["live_languages"] == ["en"]
    s = _session(client, h, language="es", answer_language="en")
    assert s["language"] == "en" and s["answer_language"] is None


def test_a_session_keeps_its_interview_and_answer_language(client: TestClient) -> None:
    h = _register(client)
    assert _session(client, h)["language"] == "en"  # the default doesn't change
    s = _session(client, h, language="es")
    assert (s["language"], s["answer_language"]) == ("es", None)  # None: answers in the interview's language
    s = _session(client, h, language="HI", answer_language="en")
    assert (s["language"], s["answer_language"]) == ("hi", "en")  # hear Hindi, answer in English
    s = _session(client, h, language="ja", answer_language="ja")
    assert s["answer_language"] is None  # the same as the interview's
    assert _session(client, h, language="auto")["language"] == "auto"
    s = _session(client, h, language="xx", answer_language="zz")
    assert (s["language"], s["answer_language"]) == ("en", None)  # unknown: English
    s = _session(client, h, type="mock", language="es", answer_language="es")
    assert (s["language"], s["answer_language"]) == ("en", None)  # a mock's language is the practice one


def test_a_saved_setup_keeps_its_languages(client: TestClient) -> None:
    h = _register(client)
    ws = client.post("/v1/workspaces", headers=h, json={
        "name": "Madrid", "language": "es", "answer_language": "en", "document_ids": []}).json()
    assert (ws["language"], ws["answer_language"]) == ("es", "en")
    updated = client.put(f"/v1/workspaces/{ws['id']}", headers=h, json={
        "name": "Madrid", "language": "fr", "document_ids": []}).json()
    assert (updated["language"], updated["answer_language"]) == ("fr", None)
    mock = client.post("/v1/workspaces", headers=h, json={
        "name": "Practice", "session_type": "mock", "language": "fr", "document_ids": []}).json()
    assert mock["language"] == "en"


# ---- transcription -------------------------------------------------------------------------------------------------

class _Configs(MockSTTProvider):
    def __init__(self) -> None:
        super().__init__()
        self.configs: list[STTConfig] = []

    async def _open(self, config: STTConfig) -> STTSession:
        self.configs.append(config)
        return MockSTTSession()


async def _configs(language: str, answer: str | None = None, session_type: str = "interview") -> list[STTConfig]:
    stt = _Configs()
    profile = SessionProfile("s1", session_type, None, language, answer or language, keyterms=["Kafka"])  # type: ignore[arg-type]

    async def send(_: dict[str, Any]) -> None: ...

    eng = LiveEngine(profile, LiveSettings(), send=send, llm=MockLLMProvider(), stt=stt, index=SessionIndex([]))
    await eng.start()
    await eng.end()
    return stt.configs


async def test_deepgram_listens_in_the_interview_language() -> None:
    english = await _configs("en")
    assert [c.language for c in english] == ["en", "en"] and english[0].filler_words  # unchanged
    for lang, expected in (("es", "es"), ("ja", "ja"), ("ru", "ru"), ("nl", "nl"), ("hi", "multi"),
                           ("hinglish", "multi"), ("auto", "multi")):
        configs = await _configs(lang)
        assert [c.language for c in configs] == [expected, expected], lang
        assert not any(c.filler_words for c in configs), lang  # an English-only Deepgram feature
        assert all(c.keyterms == ["Kafka"] for c in configs)
    # A mock interview keeps its practice-language setting (practice_language.py).
    assert [c.language for c in await _configs("hi", "en", "mock")] == ["multi", "multi"]


def test_the_stream_url_per_language() -> None:
    english = build_url("nova-3", STTConfig(language="en"))
    assert english.endswith("&endpointing=300&utterance_end_ms=1000&vad_events=true&language=en")
    assert "language=es" in build_url("nova-3", STTConfig(language="es"))
    multi = build_url("nova-3", STTConfig(language=live_language.stt_language("auto")))
    assert "language=multi" in multi and "endpointing=300" in multi  # the same timings in every language


# ---- reading the interviewer ----------------------------------------------------------------------------------------

ASKS: dict[str, list[str]] = {
    "es": ["Cuéntame sobre tu último proyecto.", "¿Cómo diseñarías un acortador de URLs?",
           "Me gustaría saber cómo manejas los conflictos.", "Explica la diferencia entre TCP y UDP",
           "¿Por qué quieres trabajar con nosotros?", "Háblame de una vez que tuviste un conflicto con tu jefe."],
    "fr": ["Parlez-moi de vous.", "Comment géreriez-vous une panne en production ?",
           "Pourquoi voulez-vous rejoindre notre entreprise ?",
           "Expliquez la différence entre un processus et un thread."],
    "de": ["Erzählen Sie mir etwas über sich.", "Wie würden Sie einen Rate Limiter entwerfen?",
           "Haben Sie schon mit Kafka gearbeitet?", "Was ist der Unterschied zwischen TCP und UDP?"],
    "pt": ["Fale sobre você.", "Como você lidaria com um conflito na equipe?",
           "Me conte sobre um projeto do qual você se orgulha.", "Explique como funciona um índice no banco de dados."],
    "it": ["Mi parli di lei.", "Come progetterebbe un sistema di pagamento?", "Perché vuole lavorare con noi?",
           "Mi spieghi la differenza tra REST e gRPC."],
    "nl": ["Vertel eens iets over jezelf.", "Hoe zou je een cache ontwerpen?", "Wat is je grootste zwakke punt?",
           "Leg uit hoe een load balancer werkt."],
    "ru": ["Расскажите о себе.", "Как бы вы спроектировали систему платежей?", "Работали ли вы с Kafka?",
           "Объясните разницу между процессом и потоком."],
    "hi": ["अपने बारे में बताइए।", "आप एक URL shortener कैसे design करेंगे?", "आपने पिछले प्रोजेक्ट में क्या किया",
           "किसी ऐसे समय के बारे में बताइए जब आपकी टीम में असहमति हुई।"],
    "hinglish": ["Apne baare mein bataiye.", "Aap ek cache kaise design karenge?",
                 "Aapne last project mein kya kiya tha", "Microservices ke baare mein samjhaiye."],
    "ja": ["自己紹介をお願いします。", "前の会社ではどんなプロジェクトを担当しましたか",
           "なぜ当社を志望されたのですか。", "キャッシュの仕組みを説明してください"],
}
NOT_ASKS: dict[str, list[str]] = {
    "es": ["Vale, perfecto.", "¿Me escuchas bien?", "Somos un equipo de cuarenta ingenieros.", "Tómate tu tiempo.",
           "Comparte tu pantalla, por favor."],
    "fr": ["D'accord, très bien.", "Vous m'entendez ?", "Nous utilisons Kubernetes ici."],
    "de": ["Alles klar, danke.", "Können Sie mich hören?", "Wir haben vierzig Entwickler."],
    "pt": ["Tá bom, beleza.", "Você está me ouvindo?", "Nós usamos Kafka aqui."],
    "it": ["Va bene, perfetto.", "Mi sente?", "Usiamo Kubernetes da due anni."],
    "nl": ["Oké, prima.", "Hoor je me?", "We gebruiken hier Kafka."],
    "ru": ["Хорошо, понятно.", "Вы меня слышите?", "У нас сорок инженеров."],
    "hi": ["ठीक है, बहुत अच्छा।", "मेरी आवाज़ आ रही है?", "हमारी टीम में चालीस इंजीनियर हैं।"],
    "hinglish": ["Theek hai, accha.", "Meri awaaz aa rahi hai?", "Hamari team mein chalis engineers hain."],
    "ja": ["はい、わかりました。", "聞こえますか？", "私たちのチームは四十人です。"],
}


@pytest.mark.parametrize(("lang", "text"), [(lang, t) for lang, items in ASKS.items() for t in items])
def test_questions_in_the_language_are_answered(lang: str, text: str) -> None:
    for ctx in (FRESH, AFTER_QUESTION):
        d = speech_for(lang).detect(text, "interviewer", ctx)
        assert d.should_generate, (lang, text, d.confidence, d.reasons)
    assert speech_for("auto").detect(text, "interviewer").should_generate, text


@pytest.mark.parametrize(("lang", "text"), [(lang, t) for lang, items in NOT_ASKS.items() for t in items])
def test_acknowledgements_check_ins_and_statements_are_not(lang: str, text: str) -> None:
    for ctx in (FRESH, AFTER_QUESTION):
        assert not speech_for(lang).detect(text, "interviewer", ctx).should_generate, (lang, text)


def test_question_types_and_sizes_in_the_language() -> None:
    es = speech_for("es")
    assert es.classify_type("¿Cómo diseñarías un sistema de pagos para millones de usuarios?") == \
        QuestionType.system_design
    assert es.classify_type("Háblame de una vez que fallaste.") == QuestionType.behavioral
    assert es.classify_type("Escribe una función que invierta una lista enlazada.") == QuestionType.coding
    assert es.pick_size("¿Has usado Docker?", QuestionType.resume) == "brief"
    assert es.pick_size("Explica en detalle cómo funciona Kafka.", QuestionType.technical) == "detailed"
    assert speech_for("ja").classify_type("自己紹介をお願いします。") == QuestionType.resume
    assert speech_for("ru").classify_type("Какая у вас зарплатная ожидания?") == QuestionType.salary
    assert speech_for("hi").classify_type("linked list को reverse करने का code लिखिए") == QuestionType.coding


def test_a_follow_up_right_after_a_question() -> None:
    d = speech_for("es").detect("¿Y por qué?", "interviewer", AFTER_QUESTION)
    assert d.should_generate and d.is_follow_up
    assert not speech_for("es").detect("¿Y por qué?", "interviewer", FRESH).is_follow_up


def test_each_line_is_read_in_its_own_language() -> None:
    assert language_of("Tell me about yourself.", ("es",), "es") == "en"
    assert language_of("¿Me escuchas bien?", ("es",), "es") == "es"
    assert language_of("अपने बारे में बताइए", ("hi", "hinglish"), "hi") == "hi"
    assert language_of("Aap kaise ho, kya haal hai?", ("hi", "hinglish"), "hi") == "hinglish"
    assert language_of("自己紹介をお願いします", LANGS, "") == "ja"
    assert language_of("Wie würden Sie das testen?", LANGS, "") == "de"
    assert language_of("How would you test it?", LANGS, "") == "en"
    # A Spanish session hears an English question as English, and answers it.
    assert speech_for("es").detect("Design a URL shortener.", "interviewer").should_generate


def test_words_in_every_script() -> None:
    assert words(fold("क्या आप बताइए?")) == ["क्या", "आप", "बताइए"]  # \w alone cuts "क्या" in two
    assert words(fold("自己紹介をしてください")) == ["自己紹介", "をしてください"]
    assert words(fold("Cuéntame, ¿qué tal?")) == ["cuentame", "que", "tal"]
    assert fold("ज़रूर") == fold("जरूर") and fold("Ёлка") == "елка"


def test_two_hindi_questions_are_not_one_duplicate() -> None:
    # English's tokenizer sees no words in Devanagari: every Hindi question looked the same, a duplicate of the first.
    d = Deduplicator(speech_for("hi"))
    d.record("q1", "t1", "अपने बारे में बताइए।", 0)
    assert d.check("t2", "आपकी सबसे बड़ी कमजोरी क्या है?", 1000)[0] == DedupDecision.new
    assert d.check("t3", "अपने बारे में बताइए।", 2000)[0] == DedupDecision.duplicate


def test_a_hindi_backchannel_doesnt_end_the_question_but_an_answer_does() -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=1500, speech=speech_for("hi"))
    assert f.on_transcript("t1", "आप एक cache कैसे design करेंगे?", 1000, is_final=True, endpoint=True) is None
    assert f.on_candidate_speech(1200, "हां जी, ठीक है") is None
    assert f.pending_question(1300) is not None  # still listening to the question
    fired = f.on_candidate_speech(1500, "मैं सबसे पहले Redis को एक layer की तरह रखूंगा")
    assert fired is not None and fired.detection.question_text.startswith("आप एक cache")


def test_japanese_completeness() -> None:
    ja = speech_for("ja")
    assert not ja.is_complete("前の会社では、プロジェクトの設計を担当していて")
    assert ja.is_complete("前の会社では何を担当しましたか")
    assert ja.is_complete("説明して")


# ---- answers --------------------------------------------------------------------------------------------------------

def _inputs(question: str, **kw: Any) -> PromptInputs:
    base: dict[str, Any] = dict(question=question, qtype=QuestionType.technical, is_follow_up=False,
                                session_type="interview", role="Backend Engineer", length="standard", style="natural",
                                answer_language="en")
    return PromptInputs(**{**base, **kw})


def _user(inputs: PromptInputs) -> str:
    return build_prompt(SessionIndex([]), inputs, SessionMemory()).messages[1].content


def test_the_prompt_says_the_language_and_keeps_code_in_english() -> None:
    es = _user(_inputs("¿Qué es una caché?", language="es", answer_language="es"))
    assert "Answer language: Spanish." in es and "Answer language: es" not in es
    assert "Code, its identifiers and its comments stay in English" in es
    assert "labels (GROUNDED:, ANSWER:" in es and "tú or usted" in es
    ja = _user(_inputs("キャッシュとは何ですか", language="ja", answer_language="ja"))
    assert "two characters per English word" in ja and "です・ます" in ja
    hi = _user(_inputs("कैश क्या है?", language="hi", answer_language="hi"))
    assert "Devanagari" in hi and "आप" in hi
    hear_hindi = _user(_inputs("कैश क्या है?", language="hi", answer_language="en"))
    assert "Answer language: English. The interviewer speaks Hindi" in hear_hindi
    auto = _user(_inputs("¿Qué es una caché?", language="auto", answer_language="auto"))
    assert "the language the interviewer asked this QUESTION in" in auto


def test_tell_me_about_yourself_in_another_language_brings_the_resume_summary() -> None:
    from orbit_api.retrieval.embeddings import get_embedder
    from orbit_api.retrieval.index import IndexedChunk

    embed = get_embedder().embed
    summary = "Backend engineer with five years in payments and Kafka"
    index = SessionIndex([IndexedChunk("r", "resume", "summary", "Summary", summary, True, embed(summary))])
    built = build_prompt(index, _inputs("Cuéntame sobre ti.", qtype=QuestionType.resume, language="es",
                                        answer_language="es"), SessionMemory())
    assert "five years in payments" in built.messages[1].content


async def _answer(language: str, answer: str, question: str) -> tuple[Sink, MockLLMProvider]:
    llm = MockLLMProvider()
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", language, answer, dev_mode=True),
                     LiveSettings(response_timing="quick"), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]))
    await eng.start()
    await eng.on_transcript("system", TranscriptEvent("final", question, 0, 900, endpoint=True))
    await sink.wait_for("answer.completed")
    await eng.end()
    return sink, llm


async def test_a_question_in_hindi_is_heard_and_answered_in_hindi() -> None:
    sink, llm = await _answer("hi", "hi", "आप एक URL shortener कैसे design करेंगे?")
    assert sink.of("question.detected")[0]["text"] == "आप एक URL shortener कैसे design करेंगे?"
    request = next(r for r in llm.requests if r.request_type == "answer")
    assert "Answer language: Hindi." in request.messages[1].content
    assert request.max_tokens > 1400 + 80  # a code-sized budget, grown for Devanagari's extra tokens


async def test_english_budgets_are_unchanged() -> None:
    _, llm = await _answer("en", "en", "How would you design a URL shortener?")
    request = next(r for r in llm.requests if r.request_type == "answer")
    assert request.max_tokens == 1400 + 80 and "Answer language: en" in request.messages[1].content


async def test_hear_spanish_answer_english() -> None:
    _, llm = await _answer("es", "en", "¿Cómo diseñarías un acortador de URLs?")
    request = next(r for r in llm.requests if r.request_type == "answer")
    assert "Answer language: English. The interviewer speaks Spanish" in request.messages[1].content
    assert request.max_tokens == 1400 + 80  # English answers: English budgets


def test_the_classifier_hears_the_language() -> None:
    english = classifier.build_request("Compare REST and gRPC.", None, [])
    assert english.messages[0].content == classifier._SYSTEM and english.max_tokens == 120
    hindi = classifier.build_request("REST और gRPC की तुलना", None, [], "hi")
    assert "Hindi" in hindi.messages[0].content and "in the language it was asked in" in hindi.messages[0].content
    assert hindi.max_tokens > 120


def test_the_parser_keeps_other_languages_as_written() -> None:
    assert humanize_in("J'utilise Kafka — surtout pour les événements.", "fr") == (
        "J'utilise Kafka, surtout pour les événements.")
    assert humanize_in("Great question. I'd utilize Kafka.", "en") == "I'd use Kafka."  # English as always
    cut = LiveAnswer(direct_answer="まずキャッシュを置きます。次にデータベースの負荷を")
    assert trim_cut_off(cut).direct_answer == "まずキャッシュを置きます。"
    parser = AnswerStreamParser("q", QuestionType.technical, [], language="ja")
    out = parser.feed("ANSWER:\nこのAPIはキャッシュを使います。\n"
                      "TERMS: API = 外部とのやり取りの窓口 | キャッシュ = 一時的な保存\nPOINTS: API | キャッシュ\n")
    assert [t.term for t in parser.finish().terms] == ["API", "キャッシュ"] and out.direct_answer


# ---- the review ------------------------------------------------------------------------------------------------------

def _plant(client: TestClient, sid: str, question: str, answer: str) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, Question, SessionTurn

    async def plant() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status = "ended"
            db.add(Question(id=f"{sid[:8]}-q", session_id=sid, text=question, type="behavioral", confidence=0.9))
            db.add(SessionTurn(id=f"{sid[:8]}-t", session_id=sid, speaker="candidate", text=answer, start_ms=0,
                               end_ms=1))
            await db.commit()

    client.portal.call(plant)  # type: ignore[union-attr]


def test_the_review_is_written_in_the_answer_language(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.sessions import report

    h = _register(client)
    llm = MockLLMProvider()
    monkeypatch.setattr(report, "get_llm_provider", lambda: llm)
    sid = _session(client, h, language="es")["id"]
    _plant(client, sid, "¿Cómo manejas los conflictos?", "Hablo primero con la persona.")
    out = client.portal.call(report.generate_report, sid)  # type: ignore[union-attr]
    system = llm.requests[-1].messages[0].content
    assert "in Spanish" in system and "never marked down for the language" in system
    assert out["language"] == "es"
    assert llm.requests[-1].max_tokens > 700 + 160

    english = _session(client, h)["id"]
    _plant(client, english, "How do you handle conflict?", "I talk to the person first.")
    out = client.portal.call(report.generate_report, english)  # type: ignore[union-attr]
    assert llm.requests[-1].messages[0].content == report._SYSTEM and "language" not in out
    assert llm.requests[-1].max_tokens == 700 + 160


def test_speaking_stats_count_words_in_any_script() -> None:
    class T:
        def __init__(self, speaker: str, text: str, start: int, end: int) -> None:
            self.speaker, self.text, self.start_ms, self.end_ms = speaker, text, start, end

    turns = [T("candidate", "मैंने पेमेंट सर्विस को स्केल किया और लेटेंसी कम की " * 4, 0, 30_000)]
    english = delivery_stats(turns)
    other = delivery_stats(turns, english=False)
    assert english is not None and other is not None
    assert english["words"] == 0 and other["words"] == 40
    assert not any("words a minute" in tip for tip in other["tips"])  # English pace thresholds don't apply


# ---- English, exactly as before --------------------------------------------------------------------------------------

ENGLISH_LINES = [*MUST_ANSWER, *MUST_NOT,
                 "Thanks for joining us today. So tell me about yourself.",
                 "Let's say you have a queue that's backing up. How would you debug it?",
                 "Tell me about your last project. What was the hardest part, and what would you do differently?",
                 "Great. Okay. Next question. Write a function that reverses a list.",
                 "Okay so, what about the caching layer and the", "Café résumé naïve: what's your take on Zürich?"]


def test_an_english_session_is_question_detector_itself() -> None:
    assert speech_for("en") is ENGLISH and speech_for(None) is ENGLISH and speech_for("xx") is ENGLISH
    for line in ENGLISH_LINES:
        assert ENGLISH.detect(line, "interviewer", AFTER_QUESTION) == qd.detect(line, "interviewer", AFTER_QUESTION)
        assert ENGLISH.tokens(line) == qd.tokens(line)
        assert ENGLISH.question_parts(line) == qd.question_parts(line)


@pytest.mark.parametrize("ctx", [FRESH, AFTER_QUESTION])
def test_english_reads_the_same_on_auto_detect(ctx: qd.DetectorContext) -> None:
    auto = speech_for("auto")
    for line in ENGLISH_LINES:
        assert auto.detect(line, "interviewer", ctx) == qd.detect(line, "interviewer", ctx), line
        assert auto.is_complete(line) == qd.is_complete(line)
        assert auto.question_parts(line) == qd.question_parts(line)
        assert auto.classify_type(line) == qd.classify_type(qd.normalize(line))


def test_english_prompts_are_unchanged() -> None:
    user = _user(_inputs("What is caching?"))
    assert "Answer language: en\n" in user and "Code, its identifiers" not in user and "LANGUAGE" not in user
    assert _user(_inputs("What is caching?")) == _user(_inputs("What is caching?", language="en"))
