/**
 * Build-time feature flags for capabilities the server doesn't fully support yet. Flip to true when the
 * matching backend feature ships, so the UI stops offering a control that would dead-end.
 */
export const VISION_ENABLED = true; // screenshots are answered by a vision model (DeepSeek-V4.1-Flash)
export const MOCK_INTERVIEW_ENABLED = true; // the AI interviewer asks (spoken via the built-in voice), you answer
