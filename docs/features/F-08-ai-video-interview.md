# AI video interview

Status: shipped 16 Oct 2026, on for everyone (no flag). Web, and the desktop app's live screen.

## What it is
A face-to-face practice interview with **Saba**, the AI interviewer:
- **Setup (`/interview`):** choose what Saba asks about:
  - a **job description** (a saved one, or paste a new one: it's saved to Documents);
  - a **topic** (free text or a chip such as "System design" or "SQL & databases");
  - **your resume**.
  Optionally add the role, company, difficulty and length (10/15/20/30 min).
- **Device check:** camera preview and a live microphone level, plus three tips, before joining.
- **The room:**
  - Full screen, like a video call: Saba's tile and your camera side by side (your camera floats over her tile on a
    phone). Saba is an animated orb: it swells with rings and a voice wave while she speaks, breathes while she
    listens, and turns while she thinks. A status chip says which.
  - The question as captions, with what you're saying live underneath.
  - Your camera tile (mirrored, on this device only).
  - A timer, and "Question n of m" with follow-ups marked.
  - A dock of round controls (mic, camera, captions, mute Saba, repeat, camera coach, end, with a confirm step),
    plus **I'm done answering** above it. Your tile shows a live mic meter.
  - The camera coach, when `ORBIT_VIDEO_MOCK` is on.
- **After:** ending opens the graded report: each answer scored, what it missed, a stronger way to say it, and the
  drill for weak answers.

## Opening and pace
- Saba opens at once with a fixed greeting, with no model call to wait on: "Hi, my name is Saba, and I'll be taking
  your interview today for the {role} role at {company}. It will take about N minutes…", then asks you to introduce
  yourself. This applies to English rounds. Hindi rounds have the model write the opening, still as Saba.
- Later questions come from the model, told it's Saba on a video call: a brief acknowledgement, then one short
  question.
- Video rounds keep a call's pace. The pause that ends an answer is 30% shorter than in the classic mock, and the next
  question starts being written after 0.6 s of silence instead of 0.9 s.
- The voice starts sooner:
  - The first sentence is synthesised on its own and plays while the rest is still being made.
  - The server's voice status is cached for ten minutes and asked ahead on the setup page, so the first question
    doesn't wait for it.

## How
- The same live, adaptive mock interviewer as Practice (`live/mock_interviewer.py`):
  - questions come from the resume and job description in the session's documents;
  - it follows up on vague answers and adjusts depth;
  - known companies are interviewed in their style;
  - it uses the natural voice (Thalia) when the server has it.
- New `MockConfig` fields:
  - `video: true` opens the session in the video-call room (`SessionOut.video`).
  - `topic` adds a TOPIC instruction, so every question tests it, with the resume and job post as context.
- `LivePanel` renders `VideoInterviewRoom` for `videoInterview` sessions. The connection, microphone, barge-in, voice
  and report are unchanged.

## Not recorded
The camera never leaves the device. No video is recorded or uploaded; only the transcript (if transcripts are kept)
and the review are saved, as with any mock interview.

## Not built (compared with Mercor, micro1 and others)
- No talking-head video avatar: Saba is an animated avatar, not a generated face.
- No recruiter-side review or sharing: it's for the candidate's own practice.
- No coding pad inside the video room: Learning AI's coding practice covers that.
