// Apply the saved theme before first paint to avoid a light/dark flash. A file, not an inline script, so the
// Content-Security-Policy can forbid inline scripts (see public/_headers).
(function () {
  try {
    var pref = localStorage.getItem("orbit.theme") || "dark";
    var dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
