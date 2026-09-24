import { useCallback, useEffect, useState } from "react";
import type { OrbitSession, SessionType, User } from "@orbit/types";
import { ApiError, ConfirmHost, OrbitLogo } from "@orbit/ui";
import { api, setAccessToken, setUnauthorizedHandler } from "./api";
import { CloseDialog } from "./CloseDialog";
import { stepGlass } from "./glass";
import { useGlobalShortcuts, useShortcutHandler, type GlobalAction } from "./globalShortcuts";
import { clearToken, loadToken } from "./native";
import { DocumentsScreen } from "./screens/Documents";
import { HistoryScreen } from "./screens/History";
import { HomeScreen } from "./screens/Home";
import { LiveScreen, type DesktopLaunch } from "./screens/Live";
import { LoginScreen } from "./screens/Login";
import { SettingsScreen } from "./screens/Settings";
import { IS_MAC, SetupScreen } from "./screens/Setup";
import { applyPanelMode, toggleMainWindow } from "./windowing";

function onAppShortcut(action: GlobalAction): void {
  if (action === "toggleWindow") void toggleMainWindow();
  else if (action === "moreTransparent") stepGlass(-0.1);
  else if (action === "lessTransparent") stepGlass(0.1);
}

type Screen =
  | { name: "boot" }
  | { name: "login" }
  | { name: "home" }
  | { name: "setup"; initialType?: SessionType }
  | { name: "documents" }
  | { name: "history" }
  | { name: "settings" }
  | { name: "live"; session: OrbitSession; launch: DesktopLaunch };

export function App() {
  useGlobalShortcuts();
  useShortcutHandler(onAppShortcut);
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [user, setUser] = useState<User | null>(null);

  const signOut = useCallback(async () => {
    setAccessToken(null);
    setUser(null);
    await clearToken().catch(() => undefined);
    setScreen({ name: "login" });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
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
  }, [signOut]);

  // The hub + management screens get room; the session config/overlay stay compact. Live sizes itself.
  useEffect(() => {
    if (screen.name === "home" || screen.name === "documents" || screen.name === "settings" || screen.name === "history") {
      void applyPanelMode("expanded");
    } else if (screen.name === "setup" || screen.name === "login") {
      void applyPanelMode("compact");
    }
  }, [screen.name]);

  const home = () => setScreen({ name: "home" });
  // Rejoin an existing (live/created) session with default audio (system on Windows, default mic).
  const resume = (session: OrbitSession) => setScreen({ name: "live", session, launch: { systemAudio: !IS_MAC } });

  return (
    <>
      {/* Keyed on the screen so every navigation fades the new screen in. */}
      <div key={screen.name} className="h-full animate-fade-in">
        {renderScreen()}
      </div>
      <CloseDialog liveActive={screen.name === "live"} />
      <ConfirmHost />
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
            onNewSession={(type) => setScreen({ name: "setup", ...(type ? { initialType: type } : {}) })}
            onResume={resume}
            onOpenDocuments={() => setScreen({ name: "documents" })}
            onOpenHistory={() => setScreen({ name: "history" })}
            onOpenSettings={() => setScreen({ name: "settings" })}
            onSignOut={() => void signOut()}
          />
        );
      case "setup":
        return (
          <SetupScreen
            user={user}
            initialType={screen.initialType}
            onSignOut={() => void signOut()}
            onBack={home}
            onStart={(session, launch) => setScreen({ name: "live", session, launch })}
            onOpenDocuments={() => setScreen({ name: "documents" })}
            onOpenHistory={() => setScreen({ name: "history" })}
            onOpenSettings={() => setScreen({ name: "settings" })}
          />
        );
      case "documents":
        return <DocumentsScreen onBack={home} />;
      case "history":
        return <HistoryScreen onBack={home} onResume={resume} />;
      case "settings":
        return user ? (
          <SettingsScreen user={user} onUser={setUser} onSignOut={() => void signOut()} onBack={home} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
            Reconnect to load your account, then open Settings again.
            <button type="button" className="ml-2 underline" onClick={home}>
              Back
            </button>
          </div>
        );
      case "live":
        return <LiveScreen session={screen.session} launch={screen.launch} onExit={home} />;
    }
  }
}
