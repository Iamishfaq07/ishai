/**
 * Build-time feature flags for capabilities the server doesn't fully support yet. Flip to true when the
 * matching backend feature ships, so the UI stops offering a control that would dead-end.
 */
export const VISION_ENABLED = false; // screenshot/coding-image analysis needs a server vision provider
export const MOCK_INTERVIEW_ENABLED = false; // the mock interviewer (AI asks questions) isn't built yet
