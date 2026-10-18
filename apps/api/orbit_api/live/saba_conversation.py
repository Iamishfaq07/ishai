"""The AI video interview as a conversation, not a quiz (DECISIONS D76): the pieces of Saba's side that need no
model call, so they're instant and cost nothing.

- When a turn is over: soon after an answer that sounds finished, later after one that trails off (`turn_end_ms`).
- What the candidate is asking for: to hear the question again, to have it put another way, a moment to think, or
  telling her they don't know (`candidate_intent`). Cheap keyword rules, in English, Hindi and Hinglish; anything
  they don't catch is simply part of the answer.
- Her fixed lines: the warm opening and the agenda, the check-in after a long silence, the closing question and the
  goodbye, each with a little variety, and the candidate's first name now and then.
"""

import re
import zlib
from typing import Literal

# A turn ends the way a person ends it, counted from when their voice stopped (the server hears the audio itself:
# the transcriber's words come in bursts about a second apart, so "no new words" isn't "quiet"): soon after an
# answer that sounds complete, later when it trails off.
WRAPPED_UP_MS = 650  # "…so yeah", "that's it"
COMPLETE_MS = 900  # ends a sentence (". ? !")
DEFAULT_MS = 1100
UNFINISHED_MS = 2600  # "…and", "so basically…", a comma: they're still going
SMALLTALK_MS = 800
# Their voice after the last words transcribed is still them talking, for this long (more is noise in the room, or a
# sound the transcriber didn't take for words: it doesn't hold the turn open).
VOICE_AHEAD_MS = 3_000
# A turn whose last words aren't final yet waits for them this much longer (the transcriber's final comes ~0.3-0.8 s
# after the voice stops), so the next line is written for everything they said.
FINAL_GRACE_MS = 1_500
QUIET_FOR_CHECK_IN_MS = 2_000  # no check-in while they've just made a sound (they may be starting)
# Start writing the next line this early in a pause (thrown away if they go on): sooner when it sounds finished.
PREFETCH_COMPLETE_MS = 400
PREFETCH_OTHER_MS = 1000

CHECK_IN_AFTER_MS = 10_000  # silence after she finished asking, before she gently checks in (once per question)
WAIT_PATIENCE_MS = 25_000  # "give me a moment": no check-in for this long
SMALLTALK_WAIT_MS = 7_000  # no reply to "how's your day going?" this long after she asked it: carry on
CLOSING_WAIT_MS = 12_000  # no reply to "any questions for me?": say goodbye
MAX_CLOSING_ANSWERS = 2
GOODBYE_CAP_MS = 15_000  # end the call this long after the goodbye even if the client never says it finished
SPEAKING_MS_PER_WORD = 380  # an estimate of how long she takes to say a line, when the client doesn't say

_UNFINISHED = re.compile(
    r"(?:,|…|\.\.\.|\b(?:and|but|so|because|or|which|that|then|like|um+|uh+|the|a|an|to|of|with|if|basically|"
    r"actually|i mean|you know|for example|such as|aur|lekin|toh|matlab|ki|ke|jaise|और|लेकिन|तो|कि))\s*$",
    re.IGNORECASE)
_WRAPPED = re.compile(r"(?:\bso yeah|that'?s (?:it|all|about it|basically it)|"
                      r"and that'?s (?:how|why|what)\b[^,;.!?]{0,40}|i'?m done|that'?s my answer|"
                      r"hope that answers[^,;.!?]{0,30}|bas itna|bas yahi)[.!]?\s*$", re.IGNORECASE)
_TERMINAL = re.compile(r"[.!?।]['\")\]]*\s*$")


def turn_end_ms(answer: str) -> int:
    """How long a pause ends this turn of the video interview."""
    text = answer.strip()
    if _UNFINISHED.search(text):
        return UNFINISHED_MS
    if _WRAPPED.search(text):
        return WRAPPED_UP_MS
    if _TERMINAL.search(text):
        return COMPLETE_MS
    return DEFAULT_MS


def prefetch_after_ms(answer: str) -> int:
    """How far into a pause to start writing the next line."""
    text = answer.strip()
    if _UNFINISHED.search(text):
        return PREFETCH_OTHER_MS
    return PREFETCH_COMPLETE_MS if (_TERMINAL.search(text) or _WRAPPED.search(text)) else PREFETCH_OTHER_MS


Intent = Literal["repeat", "rephrase", "wait", "dont_know", "no", "yes"]

_REPEAT = re.compile(
    # "Can you repeat?" is how the transcriber often writes "can you repeat that?" (D76: it was taken for an answer).
    r"\b(?:(?:can|could|would) you (?:please )?repeat|repeat (?:that|the question|it|please|again)|please repeat|"
    r"say (?:that|it) again|(?:sorry|pardon)\W*(?:what|me)?\W*$|"
    r"come again|(?:didn'?t|did not|couldn'?t|could not) (?:catch|hear|get) (?:that|you|it|the question)|"
    r"one more time|what was the question|ask (?:that|it) again|"
    r"dobara|phir se (?:boliye|bolo|puchiye)|fir se|दोबारा|फिर से)\b|^(?:sorry|what|huh|pardon)\W*$|"
    r"^(?:\W*\w+){0,2}\W*repeat\W*$", re.IGNORECASE)
_REPHRASE = re.compile(
    r"\b(?:rephrase|reword|(?:say|put|ask) (?:it|that) (?:another way|differently|in a different way)|another way|"
    r"what do you mean|(?:i )?(?:don'?t|do not) (?:understand|get) (?:the|your|that|what)|"
    r"(?:could|can) you (?:clarify|explain the question)|not sure what you mean|samajh nahi aaya|"
    r"samjha nahi|समझ नहीं)\b", re.IGNORECASE)
_WAIT = re.compile(
    r"\b(?:give me (?:a|one) (?:moment|second|sec|minute|bit)|let me think|(?:one|a|just a) (?:moment|second|sec)|"
    r"hold on|hang on|let me gather my thoughts|bear with me|ek (?:minute|second|min)|sochne do|सोचने दीजिए|"
    r"एक मिनट)\b", re.IGNORECASE)
_DONT_KNOW = re.compile(
    r"\b(?:i (?:really )?(?:don'?t|do not) know|no idea|(?:i'?m |i am )?not sure|i have no (?:idea|clue)|"
    r"(?:i )?(?:can'?t|cannot|don'?t) remember|(?:i'?ve |i have )?never (?:worked|used|done|tried)|"
    r"pata nahi|nahi pata|मुझे नहीं पता|पता नहीं)\b", re.IGNORECASE)
_NO = re.compile(
    r"^(?:no|nope|nah|not really|no questions?|i'?m good|i'?m fine|that'?s (?:all|it)|nothing(?: really)?|"
    r"i think i'?m good|no,? (?:thank you|thanks)|all good|i don'?t have any|nahi|नहीं)\b", re.IGNORECASE)
_YES = re.compile(r"^(?:yes|yeah|yep|sure|please|yes please|ok(?:ay)?|haan|ji|हाँ|हां)\b", re.IGNORECASE)


def candidate_intent(text: str) -> Intent | None:
    """What a short utterance asks for, or None when it's simply (part of) an answer."""
    t = " ".join(text.lower().split())
    words = len(t.split())
    if not t or words > 12:
        return None
    if _REPEAT.search(t):
        return "repeat"
    if _REPHRASE.search(t):
        return "rephrase"
    if _WAIT.search(t):
        return "wait"
    if words <= 8 and _DONT_KNOW.search(t):
        return "dont_know"
    if words <= 6 and _NO.search(t):
        return "no"
    if words <= 4 and _YES.search(t):
        return "yes"
    return None


# A reaction is said TO them: a model's note ABOUT them ("No answer yet, just asked me to repeat the question.") is
# dropped, and the question is asked on its own.
_NOTE = re.compile(
    r"\b(?:the candidate|candidate'?s|the user|no (?:real )?answer(?: yet)?|(?:hasn'?t|has not|didn'?t|did not) "
    r"(?:answer|respond)|asked (?:me )?to (?:repeat|rephrase)|(?:he|she|they) (?:said|asked|mentioned|answered|"
    r"didn'?t)|their answer|the answer (?:was|is))\b", re.IGNORECASE)


def spoken_reaction(text: str) -> str:
    """The model's reaction, if it's something to say to the candidate; "" if it's a note about them."""
    text = " ".join(text.split())
    return "" if not text or _NOTE.search(text) else text


def first_name(name: str | None) -> str:
    """The candidate's first name for her to say, or "" when there isn't a sensible one."""
    first = (name or "").strip().split(" ")[0] if name else ""
    first = re.sub(r"[^\w'\-]", "", first)
    if not first or len(first) > 30 or "@" in (name or "") or first.isdigit():
        return ""
    return first[:1].upper() + first[1:].lower() if first.isupper() or first.islower() else first


def _pick(options: tuple[str, ...], seed: str) -> str:
    return options[zlib.crc32(seed.encode()) % len(options)]


def smalltalk_opening(name: str, interviewer: str, seed: str) -> str:
    hi = f"Hi {name}" if name else "Hi there"
    return _pick((f"{hi}, I'm {interviewer}. How's your day going?",
                  f"{hi}, I'm {interviewer}. Thanks for joining. How are you doing today?",
                  f"{hi}! I'm {interviewer}. How's your day been so far?"), seed)


_GOOD = re.compile(r"\b(?:good|great|well|fine|fantastic|awesome|not bad|pretty good|okay|ok|alright|excellent|"
                   r"accha|badhiya|theek|मस्त|अच्छा|ठीक)\b", re.IGNORECASE)
_BAD = re.compile(r"\b(?:tired|busy|long day|hectic|stressful|stressed|nervous|not great|not good|rough|bad|"
                  r"exhausted|anxious)\b", re.IGNORECASE)
_ASKED_BACK = re.compile(r"\b(?:how about you|and you|how are you|what about you|aap kaise|aap kaisi)\b", re.IGNORECASE)


def smalltalk_reaction(reply: str, seed: str) -> str:
    """A short, human reply to how their day is going (no model call: it must be instant)."""
    text = reply.strip()
    if re.search(r"\b(?:nervous|anxious)\b", text, re.IGNORECASE):
        line = "That's completely normal, and it's just practice. Take a breath, there's no rush."
    elif _BAD.search(re.sub(r"\bnot (?:too |that )?bad\b", "", text, flags=re.IGNORECASE)):
        line = _pick(("Sorry to hear that. Let's make this a useful one.",
                      "Ah, I hear you. Let's keep this relaxed.",
                      "Fair enough. Let's keep it easy-going."), seed)
    elif _GOOD.search(text):
        line = _pick(("Glad to hear it.", "Good to hear.", "Nice, glad it's going well."), seed)
    elif text:
        line = _pick(("Thanks for sharing.", "Got it, thanks.", "Thanks."), seed)
    else:
        line = ""
    if _ASKED_BACK.search(text):
        line = (line + " " if line else "") + "I'm doing well, thanks for asking."
    return line


def agenda(minutes: int, about: str, seed: str) -> str:
    return _pick((f"Here's the plan: we'll spend about {minutes} minutes{about}. I'll ask a few questions and "
                  "follow up on what you say, and when you've finished an answer, just pause and I'll pick it up.",
                  f"So, for the next {minutes} minutes or so, we'll focus{about}. I'll ask some questions and may dig "
                  "into your answers. When you're done with one, just pause.",
                  f"We've got about {minutes} minutes{about}. I'll ask a few questions and follow up as we go; "
                  "pause when you're done with an answer and I'll take it from there."), seed)


def check_in(seed: str) -> str:
    return _pick(("Take your time. Would you like me to repeat the question?",
                  "No rush. Do you want me to say the question again?",
                  "Take as long as you need. Should I repeat the question?"), seed)


def wait_line(seed: str) -> str:
    return _pick(("Of course, take your time.", "Sure, take a moment.", "No problem, take your time."), seed)


# A transition the model opened its question with ("Let's shift a bit."): said when the topic changed, not again.
_TRANSITION = re.compile(r"^(?:(?:okay|alright|right|so)[,.]?\s+)?(?:let'?s (?:shift|switch|move|change|turn)[^.?!]*"
                         r"[.!]|moving on[,.]|on a different note[,.])\s+", re.IGNORECASE)


def repeat_line(question: str, seed: str) -> str:
    asked = _TRANSITION.sub("", question.strip()) or question
    return _pick(("Sure. ", "Of course. ", "Sure, no problem. "), seed) + asked


def closing_question(name: str, seed: str) -> str:
    who = f", {name}" if name else ""
    # Right after their last answer: a word for it first, as a person would.
    return _pick((f"Thanks, that's helpful. That's all the questions I had{who}. Do you have any questions for me?",
                  f"Got it, thank you. That's everything from my side{who}. Is there anything you'd like to ask me?",
                  f"Okay, thanks{who}. That wraps up my questions. Do you have any for me?"), seed)


def goodbye(name: str, seed: str) -> str:
    who = f", {name}" if name else ""
    return _pick((f"Thanks{who}, it was really good talking with you. Your review will be ready in a moment. "
                  "Take care!",
                  f"Thank you{who}, I enjoyed this. You'll see your review in just a moment. All the best!",
                  f"Thanks so much{who}. That's the end of our call; your review is on its way. Take care!"), seed)


def anything_else(seed: str) -> str:
    return _pick((" Anything else you'd like to ask?", " Is there anything else?", " Any other questions?"), seed)


def speaking_ms(text: str) -> int:
    """Roughly how long she takes to say `text`."""
    return len(text.split()) * SPEAKING_MS_PER_WORD + 600
