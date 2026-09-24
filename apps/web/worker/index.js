// Edge entry for the Orbit web app. Static assets (the SPA) are served by Cloudflare before this runs;
// the only job here is the cron below: Render's free tier sleeps after 15 min without traffic, and the
// 30–60 s cold start then lands on whoever opens the app. /health never touches the DB, so pinging it
// keeps the API process warm without keeping the (separately metered) Neon compute awake.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(fetch(`${env.API_URL}/health`, { headers: { "user-agent": "orbit-keep-warm" } }));
  },
};
