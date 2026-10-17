// Apply the saved theme before first paint to avoid a light/dark flash. The build puts this inline in index.html
// (inlineTheme.ts), saving the page a blocking request; the Content-Security-Policy allows it by its hash
// (vite.config.ts), not inline scripts in general. Unset follows the system (a phone in daylight is often in light
// mode), and keeps following it while the page is open.
(function () {
  try {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      var pref = localStorage.getItem("orbit.theme") || "system";
      var dark = pref === "dark" || (pref === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      // The phone's status bar (and an installed app's title bar) takes the colour of the top bar under it.
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? "#080918" : "#ffffff");
    };
    apply();
    mq.addEventListener("change", apply);
  } catch (e) {}
})();
