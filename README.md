# Last-Order — Online-only deployment

This repository has been adjusted for online-only usage (PWA features disabled).

What I changed:
- Removed the <link rel="manifest"> reference from index.html.
- Removed the service worker registration script from index.html.
- Replaced sw.js with a small stub and replaced manifest.json with a note JSON (both files retained for history).

Why:
- You requested a pure online experience (no offline caching). Removing PWA registration prevents the service worker from intercepting network requests and avoids stale cached content.

If you want me to fully remove the sw.js and manifest.json files from the repository (delete), say so and I will remove them.
