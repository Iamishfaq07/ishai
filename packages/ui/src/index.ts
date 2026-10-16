export { ErrorBoundary } from "./components/ErrorBoundary";
export { AppearanceControls } from "./components/AppearanceControls";
export { OrbitLogo, OrbitWordmark } from "./components/OrbitLogo";
export { Orb, type OrbState } from "./components/Orb";
export { CountUp, Reveal, useCountUp, useInView } from "./components/Reveal";
export { CosmicBackground, SpaceBackdrop } from "./components/SpaceBackdrop";
export { PlanetHero, PulseRings, SpotIllustration } from "./components/Illustrations";
export { SessionReview } from "./components/SessionReview";
export { VerifyEmailBanner } from "./components/VerifyEmailBanner";
export { ApprovalBanner } from "./components/ApprovalBanner";
export { CostDashboard } from "./components/CostDashboard";
export {
  ACCENTS,
  DEFAULT_DESIGN,
  TEXT_SIZES,
  applyDesign,
  initDesign,
  loadDesign,
  saveDesign,
  useDesign,
  type AccentName,
  type DesignPrefs,
  type TextSize,
} from "./design/design";
export { VISION_ENABLED, MOCK_INTERVIEW_ENABLED } from "./features";
export {
  ACCOUNT_SUSPENDED,
  ApiError,
  base64ToBlob,
  createApiClient,
  queryString,
  type ApiAuth,
  type ApiClient,
  type ApiClientOptions,
  type SupportAdminItem,
  type SupportChatMessage,
  type SupportSuggestion,
  type SupportThread,
} from "./api/client";
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
export {
  ANSWER_STYLES,
  RESPONSE_TIMINGS,
  THINKING_LEVELS,
  CODING_LANGUAGES,
  EXPERIENCE_LEVELS,
  loadCodingLanguage,
  saveCodingLanguage,
  loadExperience,
  saveExperience,
  loadResponseTiming,
  loadThinking,
  saveResponseTiming,
  saveThinking,
} from "./live/preferences";
export { SIZE_HINTS, resizeTarget } from "./live/answerSize";
export { historyLabel, useAnswerHistory, type AnswerHistory } from "./live/useAnswerHistory";
export { answerAsText } from "./components/AnswerCard";
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
export { isDialogOpen, useFocusTrap, type FocusTrapOptions } from "./hooks/useFocusTrap";
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
  Meter,
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
export { checkServerUrl, trimTrailingSlashes, type ServerUrlCheck } from "./serverUrl";
export { MAX_SESSION_DOCUMENTS, practiceDocumentIds } from "./sessionDocuments";
export {
  MAX_PRACTICE,
  defaultPractice,
  practiceDocuments,
  practiceDrill,
  practiceMinutes,
  prepText,
  questionText,
  skillGapText,
  storyFromQuestion,
} from "./resumePrep";
export { linkedDocument, rememberDocument } from "./resume/storage";
export {
  KIT_LIMITS,
  KIT_SHOWN_FIRST,
  MAX_JOB_KITS,
  MESSAGE_WORDS,
  countWords,
  linesOver,
  loadKit,
  messageKit,
  saveKit,
  shownFirst,
  skillList,
  withMessageKit,
  type JobMessageKit,
  type MessageKit,
  type SavedKit,
} from "./resume/kit";
export { useReportPolling } from "./hooks/useReportPolling";
export { ReportStatusNote } from "./components/ReportStatusNote";
export { WorkspaceBar } from "./components/WorkspaceBar";
export { PreflightPanel } from "./components/PreflightPanel";
export { CompanionShare, QrCode, companionLink } from "./components/CompanionShare";
export { StoryBankNote } from "./components/StoryBankNote";
export { ResumeMakerNote } from "./components/ResumeMakerNote";
export { AnswerRatingButtons, FEEDBACK_REASONS, useAnswerRatings, type AnswerRatings } from "./components/AnswerRating";
export { CameraCard, DeliveryCard, FollowUpCard } from "./components/Insights";
export { LatencyDiagnostics } from "./components/LatencyDiagnostics";
export { FeedbackDiagnostics } from "./components/FeedbackDiagnostics";
export { applyOverrides, scoreKeyPoints, type KeyPointProgress, type PointProgress } from "./live/coverage";
export { useKeyPointProgress, type KeyPoints } from "./live/useKeyPointProgress";
export { useReadAloud, type ReadAloud, type ReadAloudStatus } from "./live/useReadAloud";
export {
  addFrame,
  diagnosticsReport,
  newChannelStats,
  redactDeviceName,
  summarize as summarizeChannel,
  type ChannelStats,
  type ChannelSummary,
  type DiagnosticsEvent,
  type Verdict,
} from "./live/audioDiagnostics";
export { READ_ALOUD_RATES, speechChunks, speechText } from "./live/readAloud";
export { splitPlaceholders } from "./live/placeholders";
export { useInterviewerVoice, type InterviewerVoice } from "./live/useInterviewerVoice";
export {
  DEVICE_VOICE,
  VOICE_CHOICE_KEY,
  playResponse,
  useNaturalVoiceSource,
  type NaturalVoiceSource,
  type VoiceOption,
} from "./live/naturalVoice";
export { MockPanel, type CameraCoach } from "./components/MockPanel";
export { ConfirmHost, confirmDialog, type ConfirmOptions } from "./components/ConfirmDialog";
export * from "./icons";

// Look and feel foundation: motion levels, toasts, skeletons, empty states, celebrations, glossary tips.
export {
  MOTION_LEVELS,
  defaultMotion,
  effectiveMotion,
  motionEnv,
  parseMotion,
  type MotionEnv,
  type MotionLevel,
} from "./design/design";
export { currentMotion, useMotion } from "./hooks/useMotion";
export { OrbitalVisualizer, orbitalState, type OrbitalState } from "./components/OrbitalVisualizer";
export { DeviceCaptureHealthPill, type CaptureHealth } from "./components/DeviceCaptureHealthPill";
export { OrbitCareerLoopHero, type CareerLinks } from "./components/OrbitCareerLoopHero";
export { InlineResumeDiff, wordDiff } from "./components/InlineResumeDiff";
export { DebriefStudio } from "./components/DebriefStudio";
export { DefenseWorkspace } from "./components/DefenseWorkspace";
export { Dropzone, ProgressRing } from "./components/Dropzone";
export { CompanyLogo, monogram } from "./components/CompanyLogo";
export { SourceChip, useSourceTracker, type SourceTracker } from "./components/SourceChip";
export { SILENT_AFTER_MS, sourceState, sourceText, type SourceChannel, type SourceState } from "./live/sourceActivity";
export { CosmicEmptyState, type CosmicEmptyVariant } from "./components/CosmicEmptyState";
export { spotlightMove } from "./components/useSpotlight";
export { ConceptDepthRadar, aggregateDepth } from "./components/ConceptDepthRadar";
export { buttonClass, type ButtonSize, type ButtonVariant } from "./components/ui";
export { Sheet, type SheetSize } from "./components/Sheet";
export { ToastHost, dismissToast, toast, type ToastOptions, type ToastTone } from "./components/Toast";
export {
  GhostPreview,
  Skeleton,
  SkeletonLine,
  LoadGate,
  useLoadPhase,
  type GhostKind,
  type LoadPhase,
  type LoadTiming,
  type SkeletonVariant,
} from "./components/Skeleton";
export { type EmptyKind, type EmptyStateProps } from "./components/ui";
export { Celebrate, celebrate, claimMilestone, hasCelebrated, type Milestone } from "./components/Celebrate";
export { GLOSSARY, Term, type GlossaryTerm } from "./components/Term";

// Look and feel: the Orbit scenes (each its own module, so a page carries only the ones it shows) and page transitions.
export { type SceneProps } from "./components/scenes/parts";
export { WelcomeScene } from "./components/scenes/WelcomeScene";
export { ResumeScene } from "./components/scenes/ResumeScene";
export { JobsScene } from "./components/scenes/JobsScene";
export { PracticeScene } from "./components/scenes/PracticeScene";
export { TrackerScene } from "./components/scenes/TrackerScene";
export { NoResultsScene } from "./components/scenes/NoResultsScene";
export { OfflineScene } from "./components/scenes/OfflineScene";
export { CelebrationScene } from "./components/scenes/CelebrationScene";
export { useViewTransitionOk, viewTransitionOk, withViewTransition } from "./hooks/useMotion";
export {
  COUNTRIES,
  INDIA,
  countryInSentence,
  countryName,
  currencyFor,
  detectCountry,
  formatNumber,
  isIndia,
  localeFor,
  sampleOffer,
  speechLang,
  type Country,
} from "./region";
export { safeLocal, safeSession, readJSON, readChoice, type SafeStorage } from "./storage";
export { passkeysSupported, createPasskey, getPasskey, passkeyErrorText } from "./passkey";
