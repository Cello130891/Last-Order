Removed PWA assets (sw.js + manifest.json) from site references and added a temporary cleanup script to index.html that unregisters service workers and clears caches on client load. 

Next steps recommended:
- Keep the temporary cleanup script live for at least 24 hours to ensure returning/installed clients unregister their SWs.
- After that, I can remove the temporary script and permanently delete sw.js and manifest.json from the repository if you want.
