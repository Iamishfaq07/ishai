import { boxOnPage, classifyField, type ProfileKey } from "../lib/fields";

export type Profile = Record<ProfileKey, string>;

const MARK = "data-orbit-filled";
const BANNER = "orbit-review-banner";

function labelFor(el: HTMLInputElement | HTMLTextAreaElement): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
  const wrapping = el.closest("label")?.textContent;
  const aria = el.getAttribute("aria-label") ?? "";
  const labelledBy = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id)?.textContent ?? "" : ""))
    .join(" ");
  return [byFor, wrapping, aria, labelledBy].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** On show to the person: rendered, not see-through or hidden (this element or a parent), and its box on the page.
 * Hidden fields are where a job page would collect what the person never reviewed. */
function onShow(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.offsetParent === null) return false;
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
    return false;
  }
  const r = el.getBoundingClientRect();
  return boxOnPage({ width: r.width, height: r.height, right: r.right, bottom: r.bottom, scrollX: window.scrollX,
    scrollY: window.scrollY });
}

/** Sets a value the way typing would, so React and other frameworks see it. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function banner(count: number): void {
  document.getElementById(BANNER)?.remove();
  const box = document.createElement("div");
  box.id = BANNER;
  box.setAttribute("role", "status");
  box.style.cssText =
    "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:12px 16px;" +
    "border-radius:12px;background:#1e1b4b;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)";
  box.textContent =
    count > 0
      ? `Orbit filled ${count} field${count === 1 ? "" : "s"} (outlined in purple). Check every field, answer the rest yourself, then submit when you're ready. Orbit doesn't submit this form for you.`
      : "Orbit didn't find empty name, email, phone or link fields to fill on this page.";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Dismiss";
  close.style.cssText = "margin-left:12px;background:transparent;color:#c7d2fe;border:1px solid #6366f1;border-radius:8px;padding:2px 10px;cursor:pointer";
  close.onclick = () => box.remove();
  box.appendChild(close);
  document.body.appendChild(box);
}

/**
 * Fills this page's empty name, email, phone, location and link fields from the profile, outlines each one it
 * filled, and shows a banner asking the person to review. Never overwrites what's typed, never touches answers that
 * are theirs to give (salary, visa, why-us…), never uploads a file and never submits (auto-apply, which can, is separate
 * and opt-in: lib/autoApply).
 */
export function fillForm(profile: Profile): { filled: string[] } {
  const filled: string[] = [];
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  for (const el of fields) {
    if (el.disabled || el.readOnly || el.value.trim() || !onShow(el)) continue;
    const key = classifyField({
      name: el.name ?? "",
      id: el.id ?? "",
      label: labelFor(el),
      autocomplete: el.getAttribute("autocomplete") ?? "",
      placeholder: el.getAttribute("placeholder") ?? "",
      type: (el.getAttribute("type") ?? (el instanceof HTMLTextAreaElement ? "textarea" : "text")).toLowerCase(),
    });
    const value = key ? profile[key] : "";
    if (!key || !value) continue;
    setValue(el, value);
    el.setAttribute(MARK, key);
    el.style.outline = "2px solid #8b5cf6";
    el.style.outlineOffset = "1px";
    filled.push(key);
  }
  banner(filled.length);
  return { filled };
}
