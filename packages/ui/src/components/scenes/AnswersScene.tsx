import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

/** My answers: the question you expect, and the answer you worked out, kept and ticked. */
export function AnswersScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 26, 1], [226, 18, 0.8], [222, 138, 1], [24, 136, 0.8], [124, 146, 0.8]]} />
      {/* The question, a quieter bubble behind. */}
      <path d="M40 28h88a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H66l-12 10V72H40a8 8 0 0 1-8-8V36a8 8 0 0 1 8-8z" className={PAPER} />
      <rect x="44" y="42" width="60" height="3.5" rx="1.75" className={BAR} />
      <rect x="44" y="52" width="44" height="3.5" rx="1.75" className={BAR} />
      {/* The answer, yours. */}
      <path d="M112 66h88a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8h-20v12l-14-12h-54a8 8 0 0 1-8-8V74a8 8 0 0 1 8-8z" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <rect x="116" y="80" width="40" height="4" rx="2" className={ACCENT_FILL} />
      <rect x="116" y="92" width="76" height="3" rx="1.5" className={BAR} />
      <rect x="116" y="100" width="70" height="3" rx="1.5" className={BAR} />
      <rect x="116" y="108" width="54" height="3" rx="1.5" className={BAR} />
      {/* Kept. */}
      <circle cx="208" cy="66" r="10" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
      <path d="m203.5 66 3 3 6-6.5" className={ACCENT} strokeWidth="1.5" />
      <path d="M136 66V56" className={LINE} strokeDasharray="2 3" />
    </Scene>
  );
}
