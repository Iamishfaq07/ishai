import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

/** The evidence vault: a claim lifted word for word from your resume, kept under its shield. */
export function EvidenceScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 20, 1], [226, 24, 0.8], [214, 140, 1], [24, 134, 0.8], [118, 12, 0.8]]} />
      {/* The source: a resume, one line marked. */}
      <rect x="26" y="26" width="80" height="108" rx="7" className={PAPER} />
      <rect x="36" y="38" width="36" height="4" rx="2" className={BAR} />
      <rect x="36" y="52" width="60" height="3" rx="1.5" className={BAR} />
      <rect x="32" y="60" width="68" height="11" rx="3" className={`${ACCENT_SOFT} ${ACCENT}`} />
      <rect x="36" y="64" width="54" height="3" rx="1.5" className="fill-indigo-500/60 dark:fill-indigo-400/60" />
      <rect x="36" y="78" width="56" height="3" rx="1.5" className={BAR} />
      <rect x="36" y="86" width="48" height="3" rx="1.5" className={BAR} />
      <rect x="36" y="100" width="52" height="3" rx="1.5" className={BAR} />
      {/* Where it goes: the vault. */}
      <path d="M100 66c18 0 26-6 46-6" className={ACCENT} strokeOpacity="0.6" strokeDasharray="2 4" />
      <path d="M176 34l30 11v24c0 22-14 36-30 42-16-6-30-20-30-42V45z" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      {/* The quote it keeps. */}
      <path d="M164 62c0-6 4-9 8-9M180 62c0-6 4-9 8-9" className={ACCENT} strokeWidth="2" />
      <circle cx="166" cy="65" r="3.5" className={ACCENT_FILL} />
      <circle cx="182" cy="65" r="3.5" className={ACCENT_FILL} />
      <path d="M160 84h32M164 92h24" className={LINE} />
    </Scene>
  );
}
