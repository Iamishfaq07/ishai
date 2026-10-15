import { useEffect, useRef, useState } from "react";
import { Monitor, X } from "@orbit/ui";
import { Button } from "./ui";

/**
 * "Test screen-share visibility": share a screen, window or tab here exactly as you would in Zoom or Meet, and see
 * the live picture the meeting app would send. Nothing is recorded or sent anywhere; stopping ends the share.
 */
export function ShareMirror() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    const ended = () => setStream(null); // the browser's own "Stop sharing" bar
    track?.addEventListener("ended", ended);
    return () => track?.removeEventListener("ended", ended);
  }, [stream]);

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const start = async () => {
    setError(null);
    try {
      setStream(await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return; // they closed the picker
      setError("This browser couldn't start a screen share. Try Chrome or Edge on a computer.");
    }
  };

  if (!supported) return null;
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">
          <span className="font-medium">Test screen-share visibility</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Pick what you'll share in the meeting and see exactly what the interviewer would see. Nothing is recorded.
          </span>
        </p>
        {stream ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            <X className="h-4 w-4" aria-hidden /> Stop test
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void start()}>
            <Monitor className="h-4 w-4" aria-hidden /> Test what they'll see
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      {stream && (
        <div className="mt-3">
          <video ref={video} autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black object-contain" aria-label="What the meeting would show" />
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            If this tab, Orbit's window or your notes are in the picture, the interviewer would see them too. Share a
            single window (the meeting's own, or your code editor) or a different screen instead.
          </p>
        </div>
      )}
    </div>
  );
}
