import { useEffect, useState } from "react";

/**
 * Whether the signed-in account is the admin (/v1/admin/status). False until known and on any error, so admin-only
 * controls never flash for anyone else. Display only: the server checks again before honouring them.
 */
export function useIsAdmin(api: { adminStatus(): Promise<{ is_admin: boolean }> }): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .adminStatus()
      .then((s) => live && setAdmin(s.is_admin))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);
  return admin;
}
