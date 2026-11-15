# Work Area Online + Offline (Android)

Android 8+ with an updated Android System WebView. Application ID: `vn.hansol.workarea.offline`. This is a separate installation from the earlier online-only APK.

The APK bundles the interface, barcode libraries and a SQLite WebAssembly runtime. It contains no customer workbook, production database, credentials or captured photos. Authenticated preparation downloads a sanitized database snapshot, excluding password hashes, sessions and other accounts' private lookup history. Business rules, validation and report formatting are shared with the server.

## Use

1. Install the signed APK, log in with Internet access and wait for offline preparation to finish.
2. HS, Stock, Label, MM, CKD, Holding intake/issue/edit/group edit, cutting conversion and local reports work using the downloaded dataset. Camera permission is requested when scanning starts.
3. New work is committed to an IndexedDB operation journal before confirmation. Closing/reopening the app rebuilds the workspace from its base snapshot and journal, including captured images. An IndexedDB failure rolls back the local operation instead of claiming success.
4. The open app uploads queued work in order when connectivity returns. Server replay validates current permissions and business rules, persists an idempotent receipt atomically with the change, and maps device-created IDs to server IDs. Holding revisions are checked; conflicts remain queued for review. Independent records are retained when a failed record and its dependent operations are explicitly canceled.
5. The sync screen can export the pending journal as a private JSON backup, retry synchronization, log in to the server again and update the dataset. Never uninstall or clear app storage with pending work. Flush the old APK's queue before switching to this APK.

Reference data is refreshed while the app is open, connected, idle and the downloaded snapshot is at least 15 minutes old; it is not replaced while work is pending. Manual refresh is available. Offline quantities/duplicate checks are provisional until server verification. Local exports explicitly identify themselves as offline/provisional. File imports, account administration, server backups and APK updates require connectivity. Uploads run while the app is open; no background service is installed.

The previous authenticated account can unlock its downloaded workspace offline using a locally derived password verifier; raw passwords and server password hashes are not stored in the APK or snapshot. A reachable server's authentication rejection does not fall back to an old password. An offline permission cache cannot establish whether an account has been revoked; replay always enforces the current server account.

## Build

- Java 17, Gradle 8.13, Android Gradle Plugin 8.13.2, Android SDK/build tools 36.
- Install the exact dependencies from `../offline/build-package.json` in a private tools directory. Set `WORKAREA_OFFLINE_TOOLS` to that directory, then run `node ../offline/build-assets.mjs` from this project (or use its full path from the repository root).
- Supply `local.properties` with your SDK location. Keep this file out of source control.
- Set `WORKAREA_KEYSTORE` and `WORKAREA_SIGN_PASSWORD`, then run `gradle assembleRelease`. The signing alias is `workarea-offline`.
- Keep the signing key/password outside the public repository and back them up privately. Updates to this package must use the same key. Generated assets, build outputs, local databases and signing material are excluded from source publication.

Bundled static content is served from the application's trusted HTTPS origin by its WebView client; API requests use the same-origin authenticated server connection. The native bridge only exports files and is unavailable to external navigations. TLS errors are canceled, file URL access is disabled, and external HTTP(S) links open in the browser. App data is excluded from Android cloud/device-transfer backups; use the explicit pending-journal export and server backup workflows.

Runtime dependency licenses are included in the APK's `offline/licenses` assets. Shared barcode library licenses are preserved under `vendor`.
