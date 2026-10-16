# AI video interview

Status: shipped 16 Oct 2026, on for everyone (no flag). Web, and the desktop app's live screen.

## What it is
A face-to-face practice interview with **Nova**, the AI interviewer:
- **Setup (`/interview`):** choose what Nova asks about:
  - a **job description** (a saved one, or paste a new one: it's saved to Documents);
  - a **topic** (free text or a chip such as "System design" or "SQL & databases");
  - **your resume**.
  Optionally add the role, company, difficulty and length (10/15/20/30 min).
- **Device check:** camera preview and a live microphone level, plus three tips, before joining.
- **The room:**
  - Nova's tile: an avatar that pulses while speaking and shows a wave while listening.
  - The question as captions, with what you're saying live underneath.
  - Your camera tile (mirrored, on this device only).
  - A timer, and "Question n of m" with follow-ups marked.
  - Controls: pause mic, camera on/off, captions, mute Nova, repeat, **I'm done answering**, end interview.
  - The camera coach, when `ORBIT_VIDEO_MOCK` is on.
- **After:** ending opens the graded report: each answer scored, what it missed, a stronger way to say it, and the
  drill for weak answers.

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
- No talking-head video avatar: Nova is an animated avatar, not a generated face.
- No recruiter-side review or sharing: it's for the candidate's own practice.
- No coding pad inside the video room: Learning AI's coding practice covers that.
