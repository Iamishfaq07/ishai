import { useCallback, useEffect, useState } from "react";
import type { OrbitSession, User } from "@orbit/types";
import { ApiError } from "@orbit/ui";
import { api, setAccessToken, setUnauthorizedHandler } from "./api";
import { clearToken, loadToken } from "./native";
import { LiveScreen, type DesktopLaunch } from "./screens/Live";
import { LoginScreen } from "./screens/Login";
import { SetupScreen } from "./screens/Setup";

type Screen =
  | { name: "boot" }
  | { name: "login" }
  | { name: "setup" }
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
        />
      );
    case "live":
      return <LiveScreen session={screen.session} launch={screen.launch} onExit={() => setScreen({ name: "setup" })} />;
  }
}
