/** Keep network retries idempotent, but give edited content a new request identity. */
export type PendingRequests = Record<string, { fingerprint: string; id: string }>;
export function requestKey(requests: PendingRequests, action: string, body: object): string {
  const fingerprint = JSON.stringify(body);
  if (requests[action]?.fingerprint !== fingerprint) requests[action] = { fingerprint, id: crypto.randomUUID() };
  return requests[action]!.id;
}
