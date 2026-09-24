import { useCallback, useEffect, useState } from "react";
import type { OrbitSession, User } from "@orbit/types";
import { ApiError } from "@orbit/ui";
import { api, setAccessToken, setUnauthorizedHandler } from "./api";
import { clearToken, loadToken } from "./native";
import { DocumentsScreen } from "./screens/Documents";
import { LiveScreen, type DesktopLaunch } from "./screens/Live";
import { LoginScreen } from "./screens/Login";
import { SettingsScreen } from "./screens/Settings";
import { SetupScreen } from "./screens/Setup";
import { applyPanelMode } from "./windowing";

type Screen =
  | { name: "boot" }
  | { name: "login" }
  | { name: "setup" }
  | { name: "documents" }
  | { name: "settings" }
  | { name: "live"; session: OrbitSession; launch: DesktopLaunch };

export function App() {
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
        setScreen({ name: "setup" });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) await signOut();
        else setScreen({ name: "setup" }); // offline — keep the token; the setup screen shows the error
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Documents/Settings need room; the session screens stay compact. Live manages its own sizing.
  useEffect(() => {
    if (screen.name === "documents" || screen.name === "settings") void applyPanelMode("expanded");
    else if (screen.name === "setup" || screen.name === "login") void applyPanelMode("compact");
  }, [screen.name]);

  switch (screen.name) {
    case "boot":
      return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Starting Orbit…</div>;
    case "login":
      return (
        <LoginScreen
          onSignedIn={(u) => {
            setUser(u);
            setScreen({ name: "setup" });
          }}
        />
      );
    case "setup":
      return (
        <SetupScreen
          user={user}
          onSignOut={() => void signOut()}
          onStart={(session, launch) => setScreen({ name: "live", session, launch })}
          onOpenDocuments={() => setScreen({ name: "documents" })}
          onOpenSettings={() => setScreen({ name: "settings" })}
        />
      );
    case "documents":
      return <DocumentsScreen onBack={() => setScreen({ name: "setup" })} />;
    case "settings":
      return user ? (
        <SettingsScreen
          user={user}
          onUser={setUser}
          onSignOut={() => void signOut()}
          onBack={() => setScreen({ name: "setup" })}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
          Reconnect to load your account, then open Settings again.
          <button type="button" className="ml-2 underline" onClick={() => setScreen({ name: "setup" })}>
            Back
          </button>
        </div>
      );
    case "live":
      return <LiveScreen session={screen.session} launch={screen.launch} onExit={() => setScreen({ name: "setup" })} />;
  }
}
