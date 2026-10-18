import { type ReactNode, useEffect, useState } from "react";
import type { SessionType } from "@orbit/types";
import { Headphones, Mic, Monitor, RefreshCw, Toggle, Users, cx, focusRing, safeLocal } from "@orbit/ui";
import type { AudioApp, NativeAudioDevice } from "../../native";
import { useAppIcons, useLiveLevels } from "./levels";
import { AppMark, ChoiceTile, LevelBars } from "./tiles";

/**
 * Step 2, who Orbit hears (DESIGN.md "The desktop app"): the interviewer, as tiles for each app that holds sound
 * (its own icon, and a live meter of what it's playing now) and for each output; and you, as a tile per microphone.
 * The meters come from Windows' mixer (levels.ts): nothing is captured until a test or the session starts.
 */
export function ListenStep({
  isMac,
  type,
  interviewerUsed,
  systemAudio,
  onSystemAudio,
  apps,
  outputs,
  source,
  onSource,
  onRefresh,
  selectedApp,
  selectedIsBrowser,
  otherPlaying,
  systemDevice,
  devices,
  micId,
  onMic,
  test,
}: {
  isMac: boolean;
  type: SessionType;
  interviewerUsed: boolean;
  systemAudio: boolean;
  onSystemAudio: (on: boolean) => void;
  apps: AudioApp[];
  outputs: NativeAudioDevice[];
  source: string;
  onSource: (value: string) => void;
  onRefresh: () => void;
  selectedApp: AudioApp | undefined;
  selectedIsBrowser: boolean;
  otherPlaying: AudioApp | undefined;
  systemDevice: string | undefined;
  devices: NativeAudioDevice[];
  micId: string;
  onMic: (id: string) => void;
  /** The audio test, under the tiles. */
  test: ReactNode;
}) {
  const levels = useLiveLevels(systemAudio && !isMac);
  const icons = useAppIcons(apps);
  const appPid = source.startsWith("app:") ? source.slice(4) : "";
  const defaultOut = outputs.find((o) => o.isDefault);
  const commsOut = outputs.find((o) => o.isCommunications);
  const savedMissing = systemDevice && !["default", "communications"].includes(systemDevice) && !outputs.some((d) => d.id === systemDevice);
  const defaultMic = devices.find((d) => d.isDefault);

  const why = isMac
    ? "System audio on macOS isn't built yet, so Orbit listens through your microphone."
    : type === "phone"
      ? "Phone or room mode uses your microphone only: it hears both sides."
      : type === "mock"
        ? "Mock interviews use your microphone only: the interviewer is Orbit itself."
        : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <Headphones className="h-4 w-4 text-zinc-500" aria-hidden />
          <h3 className="text-sm font-semibold">The interviewer</h3>
          <span className="flex-1" />
          {interviewerUsed && !isMac && (
            <button
              type="button"
              onClick={onRefresh}
              className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-900/5 active:bg-zinc-900/10 dark:text-zinc-300 dark:hover:bg-white/10", focusRing)}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </button>
          )}
        </div>
        {why ? (
          <p className="rounded-xl bg-zinc-500/[0.06] px-3 py-2.5 text-xs text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-300">{why}</p>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-white/10">
              <Toggle
                checked={systemAudio}
                onChange={onSystemAudio}
                label="Hear the interviewer"
                description="Kept apart from your microphone, so Orbit knows who's speaking."
              />
            </div>
            {systemAudio && <CallConsentNote />}
            {systemAudio && (
              <div role="radiogroup" aria-label="Interviewer audio source" className="space-y-3">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Just one app (recommended)</p>
                {apps.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {apps.map((a) => {
                      const level = levels.apps.get(a.pid) ?? 0;
                      return (
                        <ChoiceTile
                          key={a.pid}
                          name="listen-to"
                          value={`app:${a.pid}`}
                          checked={appPid === String(a.pid)}
                          onChange={() => onSource(`app:${a.pid}`)}
                          art={<AppMark icon={icons.get(a.pid)} name={a.name} />}
                          title={a.name}
                          detail={a.active || level > 0.04 ? "Playing sound" : "Quiet right now"}
                          aside={<LevelBars level={level} label={`${a.name} level`} />}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-600 dark:border-white/15 dark:text-zinc-400">
                    No app holds any sound yet. Join your call (or play its test sound), then press Refresh, and it shows
                    here.
                  </p>
                )}
                <p className="pt-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Everything a speaker or headset plays</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceTile
                    name="listen-to"
                    value="out:default"
                    checked={source === "out:default"}
                    onChange={() => onSource("out:default")}
                    art={<OutputMark />}
                    title="Default output"
                    detail={defaultOut?.name ?? "Whatever Windows plays sound through"}
                    aside={<LevelBars level={levels.outputs.get("default") ?? 0} label="Default output level" />}
                  />
                  <ChoiceTile
                    name="listen-to"
                    value="out:communications"
                    checked={source === "out:communications"}
                    onChange={() => onSource("out:communications")}
                    art={<OutputMark calls />}
                    title="Call audio"
                    detail={commsOut ? `Communications device: ${commsOut.name}` : "The device Windows uses for calls"}
                    aside={<LevelBars level={levels.outputs.get("communications") ?? 0} label="Call audio level" />}
                  />
                </div>
                {(outputs.length > 0 || savedMissing) && (
                  <details className="group/more" open={Boolean(systemDevice && !["default", "communications"].includes(systemDevice))}>
                    <summary className={cx("cursor-pointer select-none rounded text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white", focusRing)}>
                      A specific device ({outputs.length})
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {outputs.map((d) => (
                        <ChoiceTile
                          key={d.id}
                          name="listen-to"
                          value={`out:${d.id}`}
                          checked={source === `out:${d.id}`}
                          onChange={() => onSource(`out:${d.id}`)}
                          art={<OutputMark />}
                          title={d.name}
                          detail={[d.isDefault && "Default", d.isCommunications && "Calls"].filter(Boolean).join(" · ") || "Output device"}
                          aside={<LevelBars level={levels.outputs.get(d.id) ?? 0} label={`${d.name} level`} />}
                        />
                      ))}
                      {savedMissing && (
                        <ChoiceTile name="listen-to" value={source} checked onChange={() => undefined} art={<OutputMark />} title="Saved device" detail="Not connected: Orbit uses the default until it's back" />
                      )}
                    </div>
                  </details>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {appPid && selectedIsBrowser
                    ? "Captures this browser's sound. Other tabs playing sound in the same browser are heard too, so close or mute them."
                    : appPid
                      ? "Only this app is heard: games, music and notifications are left out."
                      : systemDevice === "communications"
                        ? "Captures the device Windows uses for calls (often your headset). Everything it plays is heard."
                        : "Everything this output plays is heard. Pick your meeting app above to leave other sounds out."}
                  {!appPid && " If a device is unplugged, Orbit switches to the default and back by itself."}
                </p>
                {selectedApp && otherPlaying && (
                  <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    {selectedApp.name} isn't playing any sound right now, but {otherPlaying.name} is. Pick the app your interview is in.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <Mic className="h-4 w-4 text-zinc-500" aria-hidden />
          <h3 className="text-sm font-semibold">You</h3>
        </div>
        {devices.length === 0 ? (
          <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
            No microphone found. Plug one in, or allow desktop apps to use the microphone in Windows Settings → Privacy &amp;
            security → Microphone. Orbit looks again every few seconds.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Microphone" className="grid gap-2 sm:grid-cols-2">
            <ChoiceTile
              name="microphone"
              value=""
              checked={micId === ""}
              onChange={() => onMic("")}
              art={<MicMark />}
              title="System default"
              detail={defaultMic?.name ?? "Whichever microphone Windows uses"}
            />
            {devices.map((d) => (
              <ChoiceTile
                key={d.id}
                name="microphone"
                value={d.id}
                checked={micId === d.id}
                onChange={() => onMic(d.id)}
                art={<MicMark />}
                title={d.name}
                detail={d.isDefault ? "Windows' default" : "Microphone"}
              />
            ))}
            {micId && !devices.some((d) => d.id === micId) && (
              <ChoiceTile name="microphone" value={micId} checked onChange={() => undefined} art={<MicMark />} title="Saved microphone" detail="Not connected: Orbit uses the default" />
            )}
          </div>
        )}
      </div>

      {test}
    </div>
  );
}

const CONSENT_NOTE_KEY = "orbit.desktop.callConsentNote";

/**
 * A one-time note where the meeting's sound is picked (Microsoft Store policy 10.5.3): shown on the first Setup that
 * hears a call, then not again; "Don't show again" hides it at once. A reminder, never a gate.
 */
function CallConsentNote() {
  const [show] = useState(() => safeLocal.getItem(CONSENT_NOTE_KEY) === null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (show) safeLocal.setItem(CONSENT_NOTE_KEY, "seen");
  }, [show]);
  if (!show || hidden) return null;
  return (
    <p role="note" className="mb-3 flex items-center gap-2.5 rounded-xl bg-zinc-500/[0.06] px-3 py-2 text-xs text-zinc-700 dark:bg-white/[0.04] dark:text-zinc-300">
      <Users className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
      <span className="min-w-0 flex-1">Make sure the people on the call are okay with Orbit transcribing it.</span>
      <button
        type="button"
        onClick={() => {
          safeLocal.setItem(CONSENT_NOTE_KEY, "dismissed");
          setHidden(true);
        }}
        className={cx("shrink-0 rounded px-1 font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300", focusRing)}
      >
        Don't show again
      </button>
    </p>
  );
}

function OutputMark({ calls = false }: { calls?: boolean }) {
  const Icon = calls ? Headphones : Monitor;
  return (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function MicMark() {
  return (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
      <Mic className="h-4 w-4" />
    </span>
  );
}
