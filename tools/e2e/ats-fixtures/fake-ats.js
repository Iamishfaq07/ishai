// A stand-in for the ATS pages' own scripts, for the end-to-end tests only. The recorded fixtures have their
// scripts removed; this gives them just enough behaviour to be applied to: dropdowns that open and take a choice,
// file inputs that show the attached name, required-field checks, and a submit that posts to the test server and
// shows the ATS's success state. window.__FAKE_ATS = { ats, variant, options } is set by the test server.
(() => {
  const cfg = window.__FAKE_ATS || { ats: "greenhouse", variant: "ok", options: {} };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const EEO = {
    gender: ["Male", "Female", "Decline To Self Identify"],
    hispanic_ethnicity: ["Yes", "No", "Decline To Self Identify"],
    veteran_status: ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"],
    disability_status: ["Yes, I have a disability (or previously had a disability)", "No, I do not have a disability and have not had one in the past", "I do not want to answer"],
  };
  const optionsFor = (input) => {
    const id = input.id || "";
    if (cfg.options && cfg.options[id]) return cfg.options[id];
    if (EEO[id]) return EEO[id];
    const label = txt(document.getElementById(`${id}-label`)) || txt(input.closest("[data-field-path]")?.querySelector("label"));
    if (/gender/i.test(label)) return EEO.gender;
    if (/race|ethnic/i.test(label)) return ["Asian", "White", "Two or more races", "Decline To Self Identify"];
    if (/veteran/i.test(label)) return EEO.veteran_status;
    if (/disab/i.test(label)) return EEO.disability_status;
    if (/lgbt|gender identity/i.test(label)) return ["Yes", "No", "I prefer not to answer"];
    if (/country/i.test(label)) return ["India", "Indonesia", "United Kingdom", "United States"];
    if (id === "candidate-location" || /^location/i.test(label)) return ["Bengaluru, Karnataka, India", "Bengaluru Rural, Karnataka, India", "Bern, Switzerland"];
    return ["Yes", "No"];
  };

  // ---- Dropdowns (react-select on Greenhouse, the location autocomplete on Ashby) ----
  function closeMenus() {
    $$(".fake-menu").forEach((m) => m.remove());
    $$("input[role=combobox]").forEach((i) => i.setAttribute("aria-expanded", "false"));
  }
  function openMenu(input) {
    closeMenus();
    const filter = input.value.trim().toLowerCase();
    const all = optionsFor(input);
    const shown = filter ? all.filter((o) => o.toLowerCase().includes(filter)) : all;
    const shell = input.closest(".select-shell, ._inputContainer_d7ago_28, [data-field-path]") || input.parentElement;
    const menu = document.createElement("div");
    menu.className = cfg.ats === "greenhouse" ? "select__menu fake-menu" : "fake-menu";
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    list.id = `${input.id || "combo"}-listbox`;
    input.setAttribute("aria-controls", list.id);
    shown.forEach((o, i) => {
      const opt = document.createElement("div");
      opt.className = cfg.ats === "greenhouse" ? "select__option" : "option";
      opt.setAttribute("role", "option");
      opt.id = `react-select-${input.id}-option-${i}`;
      opt.textContent = o;
      opt.style.cssText = "padding:6px;cursor:pointer;background:#fff;color:#000";
      opt.addEventListener("click", () => choose(input, o));
      list.appendChild(opt);
    });
    if (!shown.length) {
      const none = document.createElement("div");
      none.textContent = "No options";
      list.appendChild(none);
    }
    menu.appendChild(list);
    menu.style.cssText = "position:relative;z-index:10;border:1px solid #ccc;background:#fff";
    shell.appendChild(menu);
    input.setAttribute("aria-expanded", "true");
  }
  function choose(input, value) {
    if (cfg.ats === "greenhouse") {
      const container = input.closest(".select__value-container");
      $(".select__placeholder", container)?.remove();
      let single = $(".select__single-value", container);
      if (!single) {
        single = document.createElement("div");
        single.className = "select__single-value";
        container.prepend(single);
      }
      single.textContent = value;
      input.value = "";
      const proxy = input.closest(".select__container")?.querySelector("input[aria-hidden=true]");
      if (proxy) proxy.value = value;
    } else {
      input.value = value;
    }
    input.dataset.chosen = value;
    closeMenus();
  }
  document.addEventListener("mousedown", (e) => {
    const control = e.target.closest?.(".select__control");
    if (control) {
      const input = $("input[role=combobox]", control);
      if (input) return openMenu(input);
    }
    if (!e.target.closest?.(".fake-menu")) closeMenus();
  });
  document.addEventListener("keydown", (e) => {
    const input = e.target.closest?.("input[role=combobox]");
    if (!input) return;
    if (e.key === "ArrowDown") openMenu(input);
    if (e.key === "Escape") closeMenus();
  });
  document.addEventListener("input", (e) => {
    const input = e.target.closest?.("input[role=combobox]");
    if (input) openMenu(input);
  });

  // ---- Files ----
  document.addEventListener("change", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files?.length) return;
    const name = input.files[0].name;
    if (cfg.variant === "upload_error") {
      const err = document.createElement("p");
      err.className = cfg.ats === "lever" ? "error-message" : "helper-text--error _error_fake";
      err.textContent = "We couldn't upload that file.";
      (input.closest(".file-upload, li.application-question, [data-field-path]") || input.parentElement).appendChild(err);
      return;
    }
    if (cfg.ats === "lever") {
      const li = input.closest("li");
      const fn = li && $(".filename", li);
      if (fn) fn.textContent = name;
      return;
    }
    const box = input.closest(".file-upload, [data-field-path]") || input.parentElement;
    const shown = document.createElement("p");
    shown.className = "fake-filename";
    shown.textContent = name;
    box.appendChild(shown);
  });

  // ---- Ashby Yes/No buttons ----
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".ashby-application-form-input-yesno button");
    if (!b) return;
    e.preventDefault();
    const group = b.parentElement;
    $$("button", group).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const box = $("input[type=checkbox]", group);
    if (box) box.checked = b.dataset.option === "yes";
  });

  // ---- Validation and submit ----
  function missing() {
    const out = [];
    for (const el of $$("input, textarea, select")) {
      const hiddenProxy = el.getAttribute("aria-hidden") === "true";
      const req = el.required || el.getAttribute("aria-required") === "true";
      if (!req || el.type === "hidden" || el.disabled) continue;
      if (el.closest("[hidden]") || (el.offsetParent === null && el.type !== "file" && el.type !== "radio" && el.type !== "checkbox" && !hiddenProxy)) continue;
      if (el.type === "radio" || el.type === "checkbox") {
        if (!$$(`input[name="${CSS.escape(el.name)}"]`).some((x) => x.checked)) out.push(el.name);
        continue;
      }
      if (el.getAttribute("role") === "combobox") {
        const chosen = el.dataset.chosen || $(".select__single-value", el.closest(".select__value-container") || document.createElement("div"))?.textContent;
        if (!chosen) out.push(el.id);
        continue;
      }
      if (el.type === "file" ? !el.files?.length : !String(el.value).trim()) out.push(el.id || el.name);
    }
    // Ashby required Yes/No questions.
    for (const entry of $$("[data-field-path]")) {
      const yn = $(".ashby-application-form-input-yesno", entry);
      if (yn && /_required/.test($("label", entry)?.className || "") && !$$("button", yn).some((b) => b.getAttribute("aria-pressed") === "true")) out.push(entry.dataset.fieldPath);
    }
    return [...new Set(out)];
  }
  function values() {
    const data = {};
    for (const el of $$("input, textarea, select")) {
      const k = el.name || el.id;
      if (!k || el.type === "hidden") continue;
      if (el.type === "file") {
        if (el.files?.length) data[k] = `file:${el.files[0].name}:${el.files[0].size}`;
      } else if (el.type === "radio" || el.type === "checkbox") {
        if (el.checked) data[k] = data[k] ? [].concat(data[k], el.value) : el.value || "on";
      } else if (el.getAttribute("role") === "combobox") {
        const v = el.dataset.chosen;
        if (v) data[k] = v;
      } else if (el.value) data[k] = el.value;
    }
    for (const b of $$(".ashby-application-form-input-yesno button[aria-pressed=true]")) data[b.closest("[data-field-path]").dataset.fieldPath] = b.textContent;
    return data;
  }
  function showErrors(ids) {
    for (const id of ids) {
      const err = document.createElement("p");
      err.className = cfg.ats === "lever" ? "error-message" : "helper-text--error";
      err.textContent = `This field is required (${id})`;
      document.body.appendChild(err);
    }
  }
  async function submit(e) {
    e?.preventDefault?.();
    if (cfg.variant === "captcha_on_submit") {
      const frame = document.createElement("iframe");
      frame.src = cfg.ats === "lever" ? "/fake-captcha/hcaptcha.com/challenge" : "/fake-captcha/recaptcha/api2/bframe?k=fake";
      frame.title = "captcha challenge";
      frame.style.cssText = "position:fixed;top:40px;left:40px;width:400px;height:520px;z-index:99;border:1px solid #999;background:#fff";
      document.body.appendChild(frame);
      return;
    }
    const gaps = missing();
    if (gaps.length) return showErrors(gaps);
    await fetch("/__fake/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ats: cfg.ats, url: location.href, data: values() }) });
    if (cfg.variant === "silent") {
      $$("form, .ashby-application-form-container").forEach((f) => f.remove());
      return;
    }
    if (cfg.ats === "greenhouse") location.href = `${location.pathname}/confirmation`;
    else if (cfg.ats === "lever") location.href = location.pathname.replace(/\/apply$/, "/thanks");
    else {
      const root = $(".ashby-application-form-container")?.parentElement;
      root.innerHTML = '<div class="ashby-application-form-success-container"><h2>Thank you for applying</h2><p>Your application was successfully submitted. We\'ll contact you if there are next steps.</p></div>';
    }
  }
  if (cfg.ats === "greenhouse") $("form")?.addEventListener("submit", submit);
  if (cfg.ats === "lever") $("#btn-submit")?.addEventListener("click", submit);
  if (cfg.ats === "ashby") $(".ashby-application-form-submit-button")?.addEventListener("click", submit);
  if (cfg.variant === "captcha") {
    const frame = document.createElement("iframe");
    frame.src = "/fake-captcha/recaptcha/api2/bframe?k=fake";
    frame.title = "recaptcha challenge expires in two minutes";
    frame.style.cssText = "width:400px;height:520px;border:1px solid #999";
    document.body.prepend(frame);
  }
})();
