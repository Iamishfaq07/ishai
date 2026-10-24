import type { ReactNode } from "react";
import { useGmail } from "../lib/useGmail";

/** Its children only once sending through Gmail is set up on this server (lib/useGmail.ts). */
export function GmailGate({ children }: { children: ReactNode }) {
  const gmail = useGmail();
  return gmail.data?.configured ? <>{children}</> : null;
}
