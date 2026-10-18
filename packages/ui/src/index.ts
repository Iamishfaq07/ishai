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
  COOKIE_DOMAIN_HEADER,
  ApiError,
  base64ToBlob,
  createApiClient,
  queryString,
  type ApiAuth,
  type ApiClient,
  type ApiClientOptions,
  type DirectRoute,
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
  experienceLevels,
  loadCodingLanguage,
  saveCodingLanguage,
  loadExperience,
  saveExperience,
  loadResponseTiming,
  loadThinking,
  saveResponseTiming,
  saveThinking,
  DEFAULT_ANSWER_SHAPE,
  loadAnswerShape,
  saveAnswerShape,
  type AnswerShape,
} from "./live/preferences";
export {
  ANSWER_LANGUAGE_HINT,
  INTERVIEW_LANGUAGE_HINT,
  LIVE_LANGUAGES,
  answerLanguages,
  interviewLanguages,
  languageName,
  loadAnswerLanguage,
  loadInterviewLanguage,
  offersLanguages,
  saveLiveLanguages,
  scriptLang,
  sessionLanguageLabel,
  readAloudLanguage,
  reportLanguageNote,
  tallScript,
  type LiveLanguageOption,
} from "./live/languages";
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
export { useMediaQuery } from "./hooks/useMediaQuery";
export { isDialogOpen, useFocusTrap, type FocusTrapOptions } from "./hooks/useFocusTrap";
export { AnswerCard, type AnswerCardProps } from "./components/AnswerCard";
export { ChatInput, type ChatInputProps } from "./components/ChatInput";
export { CodeBlock } from "./components/CodeBlock";
export { ControlBar, type ControlBarProps } from "./components/ControlBar";
export { cx, focusRing } from "./components/cx";
export {
  Badge,
  Button,
  ButtonGroup,
  Callout,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  IconButton,
  IconTile,
  Input,
  Kbd,
  Meter,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toggle,
  type BadgeTone,
  type CalloutTone,
} from "./components/ui";
// The component system (round 3): forms, data display, menus and tooltips. DESIGN.md has the inventory.
export { Checkbox, RadioGroup, SearchInput, SegmentedControl, Slider } from "./components/forms";
export {
  Avatar,
  Breadcrumbs,
  Pagination,
  ProgressBar,
  StatTile,
  Stepper,
  TabPanel,
  Table,
  TableEmpty,
  TableLoading,
  Tabs,
  Td,
  THead,
  Th,
  Tr,
  tabClass,
  tabListClass,
  type SortDirection,
} from "./components/data";
export { MenuButton, Popover, SplitButton, Tooltip, floatingClass, menuItemClass, menuKeys, useDismiss, type MenuItem } from "./components/Menu";
export { LivePanel, type LivePanelProps, type PanelMode } from "./components/LivePanel";
export { QuestionCard, type QuestionCardProps } from "./components/QuestionCard";
export { ScreenshotPreview, type ScreenshotPreviewProps } from "./components/ScreenshotPreview";
export { StatusPill, type StatusPillProps } from "./components/StatusPill";
export { Teleprompter, type TeleprompterProps } from "./components/Teleprompter";
export { TranscriptView, type TranscriptViewProps } from "./components/TranscriptView";
export { TranscriptLog, groupLines, transcriptText, type TranscriptLine } from "./components/TranscriptLog";
export { VideoRoomTranscript } from "./components/VideoRoomTranscript";
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
export { useInterviewerVoice, type InterviewerVoice, type VoicePhase } from "./live/useInterviewerVoice";
export {
  DEVICE_VOICE,
  PACE_KEY,
  PACE_SPEED,
  VOICE_CHOICE_KEY,
  playClip,
  playResponse,
  savedPace,
  speakNatural,
  voiceChunks,
  warmVoiceStatus,
  useNaturalVoiceSource,
  type NaturalVoiceSource,
  type VoiceOption,
  type VoicePace,
} from "./live/naturalVoice";
export { speakable, wordTimeline } from "./live/speechText";
export { MockPanel, type CameraCoach } from "./components/MockPanel";
export { VideoInterviewRoom, INTERVIEWER_NAME } from "./components/VideoInterviewRoom";
export { VoiceVisualizer, type VoiceMood, type VoiceMotion } from "./components/VoiceVisualizer";
export { SpeechEnvelope, VoiceTap, analyserActivity, type VoiceActivity, type VoiceSource, type WordSpan } from "./live/voiceActivity";
export { useMicActivity } from "./hooks/useAudioLevel";
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
export { CosmicEmptyState, SceneArt, type CosmicEmptyVariant } from "./components/CosmicEmptyState";
export { WorkingState } from "./components/WorkingState";
export { spotlightMove } from "./components/useSpotlight";
export { ConceptDepthRadar, aggregateDepth } from "./components/ConceptDepthRadar";
export { buttonClass, type ButtonSize, type ButtonVariant } from "./components/ui";
// Interaction (DESIGN.md "Interaction", D74): a button's states, copy and success feedback, lists that move, exits.
export { ButtonSpinner, ButtonTick, MorphLabel, SelectCheck } from "./components/ui";
export { CopyButton } from "./components/CopyButton";
export { CONFIRM_MS, announce, haptic, hapticsOk, useCopy, useFlash, type CopyState } from "./hooks/useFeedback";
export { useFlip } from "./hooks/useFlip";
export { usePresence } from "./hooks/usePresence";
export { useIndicator } from "./hooks/useIndicator";
export { Dialog, DialogActions, Sheet, lockScroll, type SheetSize } from "./components/Sheet";
export { ToastHost, dismissToast, toast, updateToast, type ToastOptions, type ToastTone } from "./components/Toast";
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
export { CopilotScene } from "./components/scenes/CopilotScene";
export { OfferScene } from "./components/scenes/OfferScene";
export { StoriesScene } from "./components/scenes/StoriesScene";
export { AnswersScene } from "./components/scenes/AnswersScene";
export { EvidenceScene } from "./components/scenes/EvidenceScene";
export { DocumentsScene } from "./components/scenes/DocumentsScene";
export { LinkedInScene } from "./components/scenes/LinkedInScene";
export { CodeScene } from "./components/scenes/CodeScene";
export { LearningScene } from "./components/scenes/LearningScene";
export { VideoScene } from "./components/scenes/VideoScene";
export { BillingScene } from "./components/scenes/BillingScene";
export { SecurityScene } from "./components/scenes/SecurityScene";
export { ReferralScene } from "./components/scenes/ReferralScene";
export { InboxScene } from "./components/scenes/InboxScene";
export { InterviewDayScene } from "./components/scenes/InterviewDayScene";
export { WorkingScene, type WorkingKind } from "./components/scenes/WorkingScene";
export { KashSecScene } from "./components/scenes/KashSecScene";
export { SPOT_KINDS, Spot, type SpotKind } from "./components/scenes/spots";
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
  rupees,
  sampleOffer,
  wholeMinutes,
  speechLang,
  type Country,
} from "./region";
export {
  SAMPLE_CITY,
  companiesFor,
  currencySymbol,
  gradeCopy,
  regionExamples,
  regionWords,
  sampleCity,
  scamReport,
  type GradeCopy,
  type RegionExamples,
  type RegionWords,
  type ScamReport,
} from "./regionCopy";
export { safeLocal, safeSession, readJSON, readChoice, type SafeStorage } from "./storage";
export { passkeysSupported, createPasskey, getPasskey, passkeyErrorText } from "./passkey";
export {
  OUTCOMES,
  ROUND_TYPES,
  contextDocumentIds,
  contextSessionFields,
  contextSummary,
  dateTimeInput,
  daysUntil,
  followUpDefault,
  fromDateTimeInput,
  hasTime,
  interviewWhen,
  interviewsSoon,
  mockForRound,
  outcomeEffect,
  roundLabel,
  suggestedOutcome,
  upcomingInterviews,
} from "./interviewDay";
