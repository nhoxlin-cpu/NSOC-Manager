# Work Area → Galaxy Watch 8

## What is implemented

Work Area is a Node/SQLite web application and an offline PWA. `android-offline/app` is its Android WebView/offline wrapper, not a native scanning UI. The separate `android-offline/watch` module is a real Wear OS application. No door-lock/Ma Trận app is modified.

- **Phone APK:** a restricted JavaScript bridge sends the completed result through Wear OS Data Layer. Phone and watch use application ID `vn.hansol.workarea.offline` and the same existing release certificate. The Data Layer carries small, per-pair AES-GCM-encrypted and HMAC-signed result/control packets; a durable encrypted phone retry queue handles transient API failures. Play services handles disconnected-peer synchronization after accepting a DataItem.
- **Web/PWA:** the authenticated backend receives a durable browser outbox and exposes the paired source's last 20 results. The watch uses a foreground HTTP long-poll, which stops when its activity stops. Background web delivery uses optional **FCM + WorkManager**, not a permanent WebSocket or background polling promise.
- Actual API completion points cover HS/Stock/Label saves, duplicate preflight results, complete two-code CKD checks, Cutting lookups, Holding reference lookups and MM lookups. History/list requests do not produce events. Existing scan/normalization/business rules are unchanged.
- Each source/account has a durable monotonic sequence and each scan/lookup has an event UUID. Retries keep that event; equal codes from separate valid scans remain separate events. SQLite deduplicates Data Layer and backend delivery together. History is sorted by sequence, not arrival order. Only 20 payloads are shown; older IDs remain as deduplication tombstones.
- Payloads contain raw and lookup codes, an actual status, part/model name and a bounded display-field list. No images, passwords, full MM records or inventory writes are transferred. All watch screens mark results as scan history, not current inventory. Offline results are explicitly provisional.
- New events update an open watch activity, vibrate once in front, or create a normal vibration-channel notification in the background when permission/settings permit. No full-screen intent, wake-screen flag or forced activity launch is used.

## Install and pair

1. Download the **phone APK** and **Work Area Watch APK** from Work Area → **Tải xuống & Sao lưu → Galaxy Watch**.
2. Update the existing phone APK in place; do not uninstall an app with unsynchronized work. Use Bugjaeger/ADB to install `WorkArea-Watch-1.0.0.apk` **on the watch**. The phone APK goes on the phone, not the watch.
3. Open **Work Area Watch**. Tap **Lấy mã ghép đôi mới**; first pairing needs Internet. The eight-digit code expires in five minutes.
4. On the scanning phone/browser, log in to Work Area normally. Open **Tải xuống & Sao lưu → Galaxy Watch**, enter the code and approve pairing. This pairs the exact browser/app source and account, not every user/device on the server.
5. Enable **Gửi kết quả sang đồng hồ**. Allow notifications on the watch if background notifications are wanted. Then scan as usual. CKD publishes only after both codes and the completed check exist; no tap on Save is required to mirror a completed check.
6. Data Layer needs the corresponding APK on both Android devices and normal Galaxy Wearable/Bluetooth connectivity. Browser/PWA use requires Internet for delivery to the watch; offline browser results wait durably until the browser is open and connected again. The phone APK can use Data Layer without Internet after pairing.

Disabling/revoking a pairing prevents new transfers; packets already in transport can arrive later and are filtered by the paired source/control cutoff. Account changes clear native bindings; another account cannot reuse the old watch's backend bearer. Unpairing on the watch clears its local history; also remove an unused pairing from the phone panel.

## Push configuration — currently missing

The delivered source/APK works with Data Layer and foreground backend retrieval. **Background push from a web/PWA source is NOT configured or end-to-end verified in this release.** Nothing in this repository provides a real Firebase project/service account.

To enable that path:

1. Create/use a Firebase project and register Android package **`vn.hansol.workarea.offline`**. Enable the FCM HTTP v1 API. Supply these four **public Android client configuration values** when building the watch:

   - `WORKAREA_FIREBASE_APP_ID` ← `client_info.mobilesdk_app_id`
   - `WORKAREA_FIREBASE_API_KEY` ← `api_key.current_key` (public Firebase client key, not a server credential)
   - `WORKAREA_FIREBASE_PROJECT_ID` ← `project_info.project_id`
   - `WORKAREA_FIREBASE_SENDER_ID` ← `project_info.project_number`

   See `examples/watch-firebase.properties.example`. The Google Services Gradle plugin/JSON file is unnecessary: the app initializes FirebaseOptions explicitly. Empty values leave push disabled without preventing Data Layer use.
2. Keep the **service-account private JSON** only on the VPS at **`C:\apps\work-area\private\watch-fcm-service-account.json`**, readable by the WorkAreaIQC service identity. Alternatively set `WORKAREA_FCM_SERVICE_ACCOUNT` to its private path for that service. Never commit/upload this credential or put it in either APK. `examples/watch-fcm-service-account.example.json` is a shape example only.
3. Rebuild/install the watch APK with the public values. After pairing, it registers its FCM token using its scoped bearer. The server sends data-only event IDs; a WorkManager job fetches authenticated history and deduplicates it with Data Layer.
4. Grant notifications on the watch. Verify a scan while the watch app is in the background, both with and without Bluetooth/phone APK. FCM/OS connectivity, permissions, battery policies and force-stop behavior still apply; delivery is not a hard real-time guarantee.

## Build and deployment

Use the existing Java 17, Android SDK 36, Gradle 8.13 and pinned AGP project. Enable AndroidX (already set). Resolve the pinned Wearable/Firebase/WorkManager dependencies from their official Maven repositories.

Build the shared assets with `node offline/build-assets.mjs` (`WORKAREA_OFFLINE_TOOLS` points to the pinned JS build dependencies). Set `WORKAREA_KEYSTORE` and `WORKAREA_SIGN_PASSWORD` to the **existing private Work Area signing key**, alias `workarea-offline`. Then run:

```text
gradle -p android-offline :app:assembleRelease :watch:assembleRelease
gradle -p android-offline :watch:testReleaseUnitTest
```

Outputs: `android-offline/app/build/outputs/apk/release/app-release.apk` and `android-offline/watch/build/outputs/apk/release/watch-release.apk`. Verify both with apksigner and compare SHA-256 signer certificates before distributing. Losing/replacing the phone signing key requires a deliberate migration, not silently re-signing the watch.

For the existing VPS, back up first; deploy `server.mjs`, the new `lib/watch*.mjs`, changed public modules and both APK downloads. Rebuild/deploy the **entire web-offline shell** with `offline/build-web.mjs` as required by this project. Startup creates the watch tables without replacing existing business data. Restart only WorkAreaIQC. Existing service workers finish on their current shell; close old Work Area tabs and reopen to activate the new shell. The recovery bundle includes the database/pairings and deployed web shell. Preserve any future private FCM credentials separately or in the private disaster bundle, never on public GitHub.

New APIs:

- Public, rate-limited: `POST /api/watch/pair/start`, `POST /api/watch/pair/redeem` (256-bit claim secret).
- Existing session + CSRF: `GET/POST /api/watch/sender`, `POST /api/watch/pair/approve`, `/api/watch/revoke`, `/api/watch/events`.
- Watch scoped bearer: `GET /api/watch/device/events` (optional foreground `wait=1&after=...`), `POST /api/watch/device/push-token`.

Watch bearer/HMAC keys are Android-Keystore encrypted locally. Offline MM snapshots strip **all watch tables**, including other users' pairing secrets and event payloads. API results are `private, no-store` and never enter the PWA shell cache.

## Verification and remaining device checks

Automated checks cover actual scan/API hooks, incomplete CKD suppression, raw/normalized values, same-code separate occurrences, retry IDs, late ordering, disconnected browser/native bridge queueing, account/source isolation, pairing expiry/claims, revocation, snapshot privacy, real watch SQLite retention/deduplication, ordinary background notifications and denied notification permission. The browser bridge is a contract fixture; it does not emulate Bluetooth.

**Still required on a real Galaxy Watch 8:** Bugjaeger installation, signing interoperability with the installed phone app, Bluetooth disconnect/reconnect, Data Layer service wake-up in background, one physical wrist vibration, round-screen readability, notification permission/DND behavior and FCM delivery after supplying the missing project credentials. No real watch is connected to this VPS, so these are not claimed as completed.

Primary platform references: [Data Layer security/package restrictions](https://developer.android.com/training/wearables/data/overview), [background WearableListenerService](https://developers.google.com/android/reference/com/google/android/gms/wearable/WearableListenerService), [FCM reception and WorkManager](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).
