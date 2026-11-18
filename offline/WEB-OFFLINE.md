# Web offline

Build with `WORKAREA_OFFLINE_TOOLS` pointing to the pinned build dependencies, then run `node offline/build-web.mjs`. Deploy the entire generated `web-offline` directory and `server.mjs` together. The normal public sources remain the APK build inputs; do not copy the generated app back into `public/app.js`.

The build also produces `offline/web-release.zip`, containing only the public shell and its licenses. A checkout without the build toolchain can unpack that release into `web-offline` before starting the server (`Expand-Archive offline/web-release.zip web-offline` on Windows). Regenerate this archive whenever changing bundled source; never distribute a shell containing user data.

The server publishes only files listed in the generated manifest. The service worker caches public shell assets only. Authenticated snapshots, API responses, uploads and downloads are never cached by the worker. The existing IndexedDB journal, sanitized SQLite workspace and authoritative replay handle business data.

One browser tab holds a Web Lock before opening the workspace. Worker updates wait until existing tabs close; they never force-reload a camera or pending operation. First use needs HTTPS, a current browser, a completed shell cache and a completed data download. Keep the page open to synchronize; storage persistence is requested but browser eviction and clearing browser data remain possible. Offline results are provisional.

After each change to bundled UI or business rules, rebuild the whole web shell, run the Node suite and real service-worker browser checks, back up production, and deploy the coherent bundle. Keep the APK release process separate. Never include customer data or signing keys in the generated shell or public GitHub repository.

Offline business snapshots are downloaded only by the explicit download/update button on the device synchronization page. Login, startup, periodic sync and reconnection never download or refresh snapshots. Existing cached data and pending operations remain durable; automatic outbox upload is unchanged. HS can create its own empty durable local workspace without any snapshot download.
