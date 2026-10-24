export interface PrepPack { title: string; generated_at: string; sections: { title: string; text: string }[] }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function prepPackHtml(pack: PrepPack): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(pack.title)}</title><style>body{font:18px/1.6 system-ui;max-width:48rem;margin:2rem auto;padding:1rem;color:#18181b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}section{border-top:1px solid #ccc}h1{line-height:1.2}@media print{section{break-inside:avoid}}</style><h1>${escapeHtml(pack.title)}</h1><p>Private Orbit preparation copy · ${escapeHtml(pack.generated_at)}. Saved material may be out of date. This file works offline; it contains no trackers or network requests. Delete it from shared devices after use.</p>${pack.sections.map((s) => `<section><h2>${escapeHtml(s.title)}</h2><pre>${escapeHtml(s.text)}</pre></section>`).join("")}</html>`;
}
export function downloadText(name: string, content: string, type = "text/html"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
