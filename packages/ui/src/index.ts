export { ErrorBoundary } from "./components/ErrorBoundary";
export { VISION_ENABLED, MOCK_INTERVIEW_ENABLED } from "./features";
export { ApiError, base64ToBlob, createApiClient, type ApiAuth, type ApiClient, type ApiClientOptions } from "./api/client";
export {
  LiveClient,
  type ConnectionStatus,
  type LiveClientOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from "./live/client";
export { encodeAudioBytes, encodeAudioFrame, makeClientEvent, parseServerFrame, toWebSocketUrl } from "./live/framing";
export {
  initialLiveState,
  liveReducer,
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  selectLatestInterviewerTurn,
  type AnswerStatus,
  type AnswerView,
  type ChatEntry,
  type LiveAction,
  type LiveViewState,
  type LocalAction,
  type QuestionView,
  type TurnView,
} from "./live/reducer";
export { useLiveSession, type LiveActions, type UseLiveSessionOptions, type UseLiveSessionResult } from "./live/useLiveSession";
export {
  DEFAULT_HOTKEYS,
  HOTKEY_LABELS,
  comboFromEvent,
  formatHotkey,
  isMacPlatform,
  loadHotkeys,
  matchesHotkey,
  saveHotkeys,
  useHotkeys,
  type HotkeyAction,
  type HotkeyMap,
} from "./live/hotkeys";
export { formatElapsed, useElapsed } from "./hooks/useElapsed";
export { useStickyScroll } from "./hooks/useStickyScroll";
export { AnswerCard, type AnswerCardProps } from "./components/AnswerCard";
export { ChatInput, type ChatInputProps } from "./components/ChatInput";
export { CodeBlock } from "./components/CodeBlock";
export { ControlBar, type ControlBarProps } from "./components/ControlBar";
export { cx, focusRing } from "./components/cx";
export {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toggle,
} from "./components/ui";
export { LivePanel, type LivePanelProps, type PanelMode } from "./components/LivePanel";
export { QuestionCard, type QuestionCardProps } from "./components/QuestionCard";
export { ScreenshotPreview, type ScreenshotPreviewProps } from "./components/ScreenshotPreview";
export { StatusPill, type StatusPillProps } from "./components/StatusPill";
export { Teleprompter, type TeleprompterProps } from "./components/Teleprompter";
export { TranscriptView, type TranscriptViewProps } from "./components/TranscriptView";
