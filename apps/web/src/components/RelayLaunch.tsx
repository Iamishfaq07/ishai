/**
 * The Contact page's "sent" picture: a message packet lifts off, arcs up to the relay in orbit, and the relay lights
 * up with a check. Plays once; with reduced motion it shows the end state (base.css stops the animations).
 */
export function RelayLaunch() {
  return (
    <svg viewBox="0 0 160 72" className="h-16 w-auto overflow-visible" aria-hidden="true" focusable="false">
      <path d="M14 62 Q 70 -6 132 22" fill="none" stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 5" className="cosmic-link" />
      <circle cx="14" cy="62" r="5" fill="#6366f1" fillOpacity="0.35" />
      <g className="relay-packet">
        <rect x="-7" y="-5" width="14" height="10" rx="2" fill="#38bdf8" />
        <path d="M-7 -5 L0 1 L7 -5" fill="none" stroke="#e0f2fe" strokeWidth="1.2" />
      </g>
      <g transform="translate(132 22)">
        <circle r="13" fill="#10b981" fillOpacity="0.15" stroke="#34d399" strokeWidth="1.5" className="relay-light" />
        <path d="M-5 0 l3.5 3.5 6.5 -7" fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="relay-check" />
      </g>
    </svg>
  );
}
