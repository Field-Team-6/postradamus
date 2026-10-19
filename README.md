# Postradamus

One tap: record a video (or pick the latest Practivist episode), caption it, post it everywhere.

- `index.html` — the app (installable PWA)
- `netlify/functions/prepare.js` — picks the Drive folder + next file name, hands the phone a short-lived upload token
- `netlify/functions/post.js` — schedules the post(s) through Metricool's MCP
- `netlify/functions/practivist-latest.js` — latest episode from the podcast feed
- `netlify/functions/google-auth.js` / `metricool-auth.js` — one-time approvals

Netlify environment variables: `APP_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
optional `DAILY_JASON_FOLDER_ID`, `NON_FT6_FOLDER_NAME`, `FT6_BLOG_ID`, `PERSONAL_BLOG_ID`, `PRACTIVIST_FEED`.
