// A page built as HTML (src/prerender/document.ts) paints from its own HTML and CSS, then starts the app: it lists
// the app's scripts in #orbit-app instead of loading them with the page, and this loads them once the page has
// painted. On a slow phone the first paint then doesn't share the connection with ~180 kB of scripts, and the app's
// first run doesn't hold it up (DECISIONS D79, docs/PERFORMANCE.md). Every other page loads the app as usual, and
// this does nothing. The build puts it inline in index.html (inlineTheme.ts), allowed by its hash like the theme's.
document.addEventListener("DOMContentLoaded", function () {
  var list = document.getElementById("orbit-app");
  if (!list) return;
  var started = false;
  var start = function () {
    if (started) return;
    started = true;
    var files = JSON.parse(list.textContent || "[]");
    // The entry first, then what it imports, fetched alongside it (as the build's modulepreload tags did).
    for (var i = 0; i < files.length; i++) {
      var el = document.createElement(i ? "link" : "script");
      if (i) {
        el.rel = "modulepreload";
        el.href = files[i];
      } else {
        el.type = "module";
        el.src = files[i];
      }
      el.crossOrigin = "anonymous";
      document.head.appendChild(el);
    }
  };
  // A tab opened in the background never paints: start at once, or as soon as it's hidden.
  if (document.visibilityState !== "visible") return start();
  document.addEventListener("visibilitychange", start);
  // Never left waiting for a paint that doesn't come.
  setTimeout(start, 3000);
  try {
    if (PerformanceObserver.supportedEntryTypes.indexOf("paint") < 0) throw 0;
    new PerformanceObserver(function (entries, observer) {
      if (!entries.getEntriesByName("first-contentful-paint").length) return;
      observer.disconnect();
      setTimeout(start, 0);
    }).observe({ type: "paint", buffered: true });
  } catch (e) {
    // No paint timing: just after the next frame is drawn (a frame's callback runs before it's drawn, a task queued
    // from there after it).
    requestAnimationFrame(function () {
      setTimeout(start, 0);
    });
  }
});
