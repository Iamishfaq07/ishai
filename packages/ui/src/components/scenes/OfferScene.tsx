import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

/** Offer AI: the offer letter, and a balance weighing it against the market. */
export function OfferScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 20, 1], [228, 26, 0.8], [214, 142, 1], [112, 12, 0.8], [26, 140, 0.8]]} />
      {/* The letter, with its seal. */}
      <rect x="28" y="22" width="76" height="104" rx="7" className={PAPER} />
      <rect x="38" y="34" width="34" height="4" rx="2" className={ACCENT_FILL} />
      <rect x="38" y="46" width="56" height="3" rx="1.5" className={BAR} />
      <rect x="38" y="54" width="50" height="3" rx="1.5" className={BAR} />
      <rect x="38" y="62" width="54" height="3" rx="1.5" className={BAR} />
      <rect x="38" y="78" width="28" height="3" rx="1.5" className={BAR} />
      <rect x="38" y="86" width="40" height="3" rx="1.5" className={BAR} />
      <circle cx="86" cy="108" r="9" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
      <path d="m82 108 3 3 5.5-6" className={ACCENT} strokeWidth="1.5" />
      {/* The balance: the offer on one pan, the market on the other, nearly level. */}
      <path d="M170 44v84M150 132h40" className={LINE} strokeWidth="1.5" />
      <path d="M134 58l72-6" className={ACCENT} strokeWidth="1.5" />
      <circle cx="170" cy="55" r="3" className={ACCENT_FILL} />
      <path d="M134 58l-10 22h20zM206 52l-10 22h20z" className={LINE} />
      <path d="M122 80a12 5 0 0 0 24 0" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <path d="M194 74a12 5 0 0 0 24 0" className={PAPER} />
      <rect x="128" y="70" width="12" height="6" rx="1.5" className={`${ACCENT_SOFT} ${ACCENT}`} />
      <rect x="200" y="62" width="12" height="6" rx="1.5" className={PAPER} />
      <rect x="200" y="56" width="12" height="6" rx="1.5" className={PAPER} />
    </Scene>
  );
}
