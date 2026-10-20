/** An optional job context, never an arbitrary return URL. The destination enforces its own ownership. */
export function resumeReturnJob(search: string): string | null {
  const id = new URLSearchParams(search).get("job");
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
