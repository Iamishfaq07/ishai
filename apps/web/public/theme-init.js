// Apply the saved theme before first paint to avoid a light/dark flash. A file, not an inline script, so the
// Content-Security-Policy can forbid inline scripts (see public/_headers). Unset follows the system (a phone in
// daylight is often in light mode), and keeps following it while the page is open.
(function () {
  try {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      var pref = localStorage.getItem("orbit.theme") || "system";
      document.documentElement.classList.toggle("dark", pref === "dark" || (pref === "system" && mq.matches));
    };
    apply();
    mq.addEventListener("change", apply);
  } catch (e) {}
})();
