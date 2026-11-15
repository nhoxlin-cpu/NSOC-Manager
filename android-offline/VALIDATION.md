# Release validation — 1.0.0

- Node suite: 103 tests passed, including snapshot privacy, authenticated replay, idempotency, permissions and stale deletion protection.
- Bundled browser build: exercised with 95,000 synthetic MM rows, airplane mode, cold restart, all scan modes, MM, CKD, Holding and Cutting.
- Verified durable image/operation storage, quantity precision, dependent ID translation, conflicts, expired sessions, account separation, storage failures and dataset identity protection.
- Independently opened the generated Holding workbook; tested native download chunk framing and trusted-origin URL policy.
- Release APK signature verified with Android apksigner. Bundled JavaScript/WASM checksums match the tested assets. No customer database or signing key is bundled.
- No physical Android device was connected for this release. Camera autofocus, device-specific WebView behavior and Android's save-file dialog still require verification on the user's phone.

First setup requires internet and a completed data download. Business workflows use the downloaded workspace offline; administrative file imports, account management and server backups require connectivity. Keep the app open to synchronize after reconnecting. Offline results remain provisional until accepted by the server.
