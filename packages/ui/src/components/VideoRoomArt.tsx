import type { CSSProperties } from "react";
import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LINE, PAPER, Scene, Stars, type SceneProps } from "./scenes/parts";

const BARS: Array<[number, number]> = [
  [72, 6],
  [78, 12],
  [84, 20],
  [90, 12],
  [96, 6],
];

/**
 * The video room's join moment, in the scenes' line style (hairlines, paper, one subject in the accent): a call
 * window in orbit, Saba's tile with her voice and yours with a camera lens. Her bars breathe once at Full motion.
 */
export function JoiningArt(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[16, 24, 1], [30, 138, 0.8], [214, 16, 1], [228, 126, 0.8], [122, 150, 1]]} />
      <ellipse cx="120" cy="78" rx="110" ry="60" className={LINE} strokeDasharray="1 5" />
      <rect x="40" y="30" width="160" height="96" rx="10" className={PAPER} />
      {/* Saba: her voice, not a face. */}
      <rect x="50" y="40" width="68" height="66" rx="7" className={`${ACCENT_SOFT} ${ACCENT}`} strokeOpacity="0.55" />
      <circle cx="84" cy="73" r="21" className={ACCENT} strokeOpacity="0.3" />
      <g className={ACCENT} strokeWidth="3">
        {BARS.map(([x, h], i) => (
          <path
            key={x}
            d={`M${x} ${73 - h / 2}v${h}`}
            className="motion-ok:animate-twinkle"
            style={{ animationDelay: `${i * 120}ms` } as CSSProperties}
          />
        ))}
      </g>
      {/* You: the camera, on this device only. */}
      <rect x="122" y="40" width="68" height="66" rx="7" className={PAPER} />
      <circle cx="156" cy="73" r="12" className={LINE} />
      <circle cx="156" cy="73" r="5" className={LINE} />
      {/* The dock. */}
      <g className={BAR}>
        <circle cx="106" cy="116" r="3.5" />
        <circle cx="117" cy="116" r="3.5" />
        <circle cx="128" cy="116" r="3.5" />
      </g>
      <rect x="135" y="112.5" width="12" height="7" rx="3.5" className={ACCENT_FILL} />
    </Scene>
  );
}

const CHECK_LEN = 24;

/**
 * The end of the interview, in the same style: the review being written, a page in orbit, with a check that draws
 * itself once at Full motion.
 */
export function WrapUpArt(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[22, 30, 1], [36, 128, 0.8], [206, 22, 1], [222, 120, 0.8], [118, 148, 1]]} />
      <ellipse cx="120" cy="80" rx="100" ry="52" className={LINE} strokeDasharray="1 5" />
      <rect x="80" y="22" width="80" height="110" rx="8" className={PAPER} />
      <rect x="92" y="36" width="34" height="4.5" rx="2" className={ACCENT_FILL} />
      {[52, 61, 70, 84, 93, 102].map((y, i) => (
        <rect key={y} x="92" y={y} width={[52, 46, 40, 54, 44, 30][i]} height="3" rx="1.5" className={BAR} />
      ))}
      <circle cx="152" cy="114" r="15" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
      <path
        d="M145 114.5l4.6 4.6 8.4-9"
        strokeWidth="2"
        strokeDasharray={CHECK_LEN}
        style={{ "--len": CHECK_LEN } as CSSProperties}
        className={`${ACCENT} motion-ok:animate-[orbit-draw_var(--dur-moment)_var(--ease-enter)_both] motion-ok:[animation-delay:240ms]`}
      />
    </Scene>
  );
}
