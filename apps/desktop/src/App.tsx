import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrbitSession, SessionType, User } from "@orbit/types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ApiError, ApprovalBanner, ConfirmHost, OrbitLogo, SpaceBackdrop, ToastHost, VerifyEmailBanner, confirmDialog } from "@orbit/ui";
import { WEB_URL, api, setAccessToken, setUnauthorizedHandler } from "./api";
import { CloseDialog } from "./CloseDialog";
import { openBilling } from "./credits";
import { stepGlass } from "./glass";
import { useGlobalShortcuts, useShortcutHandler, type GlobalAction } from "./globalShortcuts";
import { loadSavedAudio, rejoinLaunch, rememberLaunch, usesSystemAudio, type DesktopLaunch } from "./launch";
import { clearToken, listAudioApps, loadToken } from "./native";
import { Onboarding } from "./Onboarding";
import { onboardingDone } from "./welcomeTour";
import { DocumentsScreen } from "./screens/Documents";
import { HistoryScreen } from "./screens/History";
import { HomeScreen, type Chrome } from "./screens/Home";
import { LiveScreen } from "./screens/Live";
import { LoginScreen } from "./screens/Login";
import { SettingsScreen } from "./screens/Settings";
import { IS_MAC, SetupScreen } from "./screens/Setup";
import type { NavTarget } from "./TitleBar";
import { useTrayRequests } from "./tray";
import { confirmSessionDuringUpdate, useUpdateChecks } from "./updates";
import { webLink } from "./web";
import { applyPanelMode, loadAlwaysOnTop, setAlwaysOnTop, toggleMainWindow } from "./windowing";

function onAppShortcut(action: GlobalAction): void {
  if (action === "toggleWindow") void toggleMainWindow();
  else if (action === "moreTransparent") stepGlass(-0.1);
  else if (action === "lessTransparent") stepGlass(0.1);
}

type Screen =
  | { name: "boot" }
  | { name: "login" }
  | { name: "home" }
  | { name: "setup"; initialType?: SessionType; jobId?: string }
  | { name: "documents" }
  | { name: "history"; sessionId?: string }
  | { name: "settings" }
  | { name: "live"; session: OrbitSession; launch: DesktopLaunch };

export function App() {
  useGlobalShortcuts();
  useShortcutHandler(onAppShortcut);
  useUpdateChecks();
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [user, setUser] = useState<User | null>(null);
  // The welcome tour (Onboarding.tsx): once per device, over Home, after the first sign-in.
  const [tour, setTour] = useState(false);
  // Paid features are locked until the email is verified — but only on servers that require it.
  const [verificationRequired, setVerificationRequired] = useState(false);
  useEffect(() => {
    if (!user || user.email_verified) return;
    api.authConfig().then((c) => setVerificationRequired(c.email_verification === "required")).catch(() => undefined);
  }, [user]);
  const verifyNotice =
    user && !user.email_verified && verificationRequired ? (
      <VerifyEmailBanner
        email={user.email}
        onResend={() => api.requestVerification()}
        onRecheck={async () => {
          const fresh = await api.me();
          setUser(fresh);
          return fresh.email_verified;
        }}
      />
    ) : user?.approval_pending ? (
      <ApprovalBanner
        onRecheck={async () => {
          const fresh = await api.me();
          setUser(fresh);
          return Boolean(fresh.approval_pending);
        }}
      />
    ) : null;

  const signOut = useCallback(async () => {
    setAccessToken(null);
    setUser(null);
    await clearToken().catch(() => undefined);
    setScreen({ name: "login" });
  }, []);

  // A 401 means the sign-in is gone (desktop sign-ins expire 7 days after signing in). During a live session that
  // mustn't end the interview: the live screen stays and asks to sign in again (its audio socket keeps going).
  // Anywhere else it signs out.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [signInExpired, setSignInExpired] = useState(false);
  const onUnauthorized = useCallback(() => {
    if (screenRef.current.name === "live") setSignInExpired(true);
    else void signOut();
  }, [signOut]);
  useEffect(() => {
    if (screen.name !== "live") setSignInExpired(false);
  }, [screen.name]);
  const signedInAgain = (fresh: User) => {
    setUser(fresh);
    setSignInExpired(false);
  };

  useEffect(() => {
    setUnauthorizedHandler(onUnauthorized);
    (async () => {
      const token = await loadToken().catch(() => null);
      if (!token) {
        setScreen({ name: "login" });
        return;
      }
      setAccessToken(token);
      try {
        setUser(await api.me());
        setScreen({ name: "home" });
      } catch (err) {
        // 401: dead token. 403: this server no longer allows the account (ORBIT_ALLOWED_EMAILS).
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) await signOut();
        else setScreen({ name: "home" }); // offline — keep the token; screens show their own errors
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut, onUnauthorized]);

  // Started offline with a saved sign-in: load the account once the connection is back (focus, "online", or every
  // 30 s), so Settings and the banners don't stay stuck on "reconnect". (A 401 already went to onUnauthorized.)
  const reloadUser = useCallback(() => {
    api
      .me()
      .then(setUser)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) void signOut();
      });
  }, [signOut]);
  const signedInOffline = user === null && screen.name !== "boot" && screen.name !== "login";
  useEffect(() => {
    if (!signedInOffline) return;
    window.addEventListener("focus", reloadUser);
    window.addEventListener("online", reloadUser);
    const t = window.setInterval(reloadUser, 30_000);
    return () => {
      window.removeEventListener("focus", reloadUser);
      window.removeEventListener("online", reloadUser);
      window.clearInterval(t);
    };
  }, [signedInOffline, reloadUser]);

  // The window opens always on top (tauri.conf.json); someone who unpinned it in a session gets it unpinned at launch
  // too, not only once the next session opens.
  useEffect(() => {
    if (!loadAlwaysOnTop()) void setAlwaysOnTop(false).catch(() => undefined);
  }, []);

  // Sign-in, the hub, Setup and the management screens get room; the live overlay sizes itself (compact or expanded).
  useEffect(() => {
    if (["login", "home", "setup", "documents", "settings", "history"].includes(screen.name)) {
      void applyPanelMode("expanded");
    }
  }, [screen.name]);

  // The first Home after signing in on this device opens the welcome tour.
  useEffect(() => {
    if (screen.name === "home" && user && !onboardingDone()) setTour(true);
  }, [screen.name, user]);

  const home = () => setScreen({ name: "home" });
  const navigate = useCallback((to: NavTarget) => setScreen({ name: to } as Screen), []);
  const chrome: Chrome = useMemo(
    () => ({
      onNavigate: navigate,
      ...(user
        ? {
            account: {
              name: user.name ?? null,
              email: user.email,
              onBilling: () => openBilling(),
              onWeb: () => void openUrl(webLink(WEB_URL, "/", "settings")),
              onSignOut: () => void signOut(),
            },
          }
        : {}),
    }),
    [navigate, signOut, user],
  );

  // The tray's items: a screen (never leaving a live session), or the web in the browser.
  useTrayRequests((request) => {
    if (request === "web") {
      void openUrl(webLink(WEB_URL, "/", "tray"));
      return;
    }
    const now = screenRef.current.name;
    if (now === "live" || now === "boot" || now === "login") return;
    if (request === "new-session") setScreen({ name: "setup" });
    else setScreen({ name: request } as Screen);
  });

  const goLive = (session: OrbitSession, launch: DesktopLaunch) => {
    rememberLaunch(session.id, launch);
    setScreen({ name: "live", session, launch });
  };
  // Rejoin an existing (live/created) session with the audio it was set up with (launch.ts): its app found again,
  // else the saved mic and output; never system audio for phone or mock sessions.
  const resume = async (session: OrbitSession) => {
    // The AI video interview is a camera room the browser runs (the web's /live page draws it): rejoining it here
    // would open an audio-only copy of it.
    if (session.video) {
      const ok = await confirmDialog({
        title: "Rejoin in your browser?",
        body: "Video interviews run in the browser, with your camera. Orbit opens this one there, where it left off.",
        confirmLabel: "Open in browser",
      });
      if (ok) void openUrl(`${WEB_URL}/live/${encodeURIComponent(session.id)}`);
      return;
    }
    if (!(await confirmSessionDuringUpdate())) return;
    const apps = !IS_MAC && usesSystemAudio(session.type) ? await listAudioApps() : [];
    goLive(session, rejoinLaunch(session, loadSavedAudio(), apps, IS_MAC));
  };
  // A drill is a mock round: the interviewer is Orbit itself, so only the (remembered) mic is captured.
  const drill = async (session: OrbitSession) => {
    if (!(await confirmSessionDuringUpdate())) return;
    goLive(session, rejoinLaunch(session, loadSavedAudio(), [], IS_MAC));
  };

  return (
    <>
      {/* Hidden in the workbench (html.app-shell) and while the window is see-through (index.css). */}
      <SpaceBackdrop className="space-backdrop" />
      {/* Keyed on the screen so every navigation fades the new screen in. */}
      <div key={screen.name} className="h-full animate-page-in">
        {renderScreen()}
      </div>
      {tour && screen.name === "home" && (
        <Onboarding
          onDone={(next) => {
            setTour(false);
            if (next === "start") setScreen({ name: "setup" });
          }}
        />
      )}
      <CloseDialog liveActive={screen.name === "live"} />
      <ConfirmHost />
      <ToastHost />
    </>
  );

  function renderScreen() {
    switch (screen.name) {
      case "boot":
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
            <OrbitLogo size={40} busy />
            Starting Orbit…
          </div>
        );
      case "login":
        return (
          <LoginScreen
            onSignedIn={(u) => {
              setUser(u);
              home();
            }}
          />
        );
      case "home":
        return (
          <HomeScreen
            user={user}
            chrome={chrome}
            notice={verifyNotice}
            hidePromos={tour}
            onNewSession={(type) => setScreen({ name: "setup", ...(type ? { initialType: type } : {}) })}
            onPrepareInterview={(entry) => setScreen({ name: "setup", initialType: "interview", jobId: entry.id })}
            onResume={resume}
            onOpenHistory={() => setScreen({ name: "history" })}
            onOpenSession={(id) => setScreen({ name: "history", sessionId: id })}
          />
        );
      case "setup":
        return (
          <SetupScreen
            user={user}
            chrome={chrome}
            notice={verifyNotice}
            {...(screen.initialType ? { initialType: screen.initialType } : {})}
            {...(screen.jobId ? { initialJobId: screen.jobId } : {})}
            onSignedInAgain={setUser}
            onStart={goLive}
          />
        );
      case "documents":
        return <DocumentsScreen chrome={chrome} />;
      case "history":
        return <HistoryScreen chrome={chrome} onResume={resume} onDrill={drill} {...(screen.sessionId ? { initialSessionId: screen.sessionId } : {})} />;
      case "settings":
        return user ? (
          <SettingsScreen
            user={user}
            chrome={chrome}
            onUser={setUser}
            onSignOut={() => void signOut()}
            onReplayTour={() => {
              home();
              setTour(true);
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500">
            <p>Orbit can't reach your account right now. Check your internet connection.</p>
            <span className="flex gap-3">
              <button type="button" className="font-medium text-indigo-600 underline dark:text-indigo-300" onClick={reloadUser}>
                Try again
              </button>
              <button type="button" className="underline" onClick={home}>
                Back
              </button>
            </span>
          </div>
        );
      case "live":
        return (
          <LiveScreen
            session={screen.session}
            launch={screen.launch}
            onExit={home}
            onViewReview={() => setScreen({ name: "history", sessionId: screen.session.id })}
            signInExpired={signInExpired}
            email={user?.email ?? null}
            onSignedInAgain={signedInAgain}
          />
        );
    }
  }
}
