import { api } from "./api";
import { useAsync } from "./useAsync";

export interface GmailStatus { configured: boolean; connected: boolean; email: string | null }

/** Whether sending through Gmail is set up on this server and connected for this account (one shared request).
 *  Until the server has Gmail configured, every Gmail part of the app stays hidden rather than showing a dead end. */
export function useGmail() {
  return useAsync(() => api.call<GmailStatus>("/v1/gmail"), [], "gmail-connection");
}
