# Wear OS release 1.0.0

Built together with phone release **1.1.0 / versionCode 6**. Watch release is **1.0.0 / versionCode 1**, minSdk 30, targetSdk 36. Both use application ID `vn.hansol.workarea.offline`.

The new phone, new watch and previously deployed phone have the same verified signing-certificate SHA-256:

```text
ba0099bde7adfe545b91efa498435b765f19843df2cf2b2fdd62d9f06242c49f
```

- **121 Node tests passed**, including pairing claims/expiry, existing session/CSRF, source/account isolation, immutable event retries, ordered 20-result history, late settings, revocation, foreground long-poll and removal of watch secrets from offline snapshots.
- **9 Android JVM/Robolectric tests passed** on SDK 30/33: raw/normalized event rules, no invented quality status, HMAC tampering, encrypted per-pair packets, stale native account/source bindings, actual SQLite deduplication/20-result retention/late ordering, ordinary background notifications without full-screen intents and declined notification permission.
- Real browser/API completion hooks passed HS raw/lookup values, separate same-code occurrences, two-code CKD completeness, offline bridge/outbox, late responses, retries and enable/disable pairing. The native JavaScript bridge in this browser test is a contract fixture, not a Bluetooth emulator.
- The existing 95,000-row offline regression passed across HS, Stock, Label, MM, CKD, Holding and Cutting, including restart, replay, account isolation, quota failure and report export.
- Release signatures and packaged phone JavaScript assets were verified. No customer database, workbooks, signing private key or service-account credential is packaged.

**Not tested on hardware:** no Android/Watch device was attached to ADB. Galaxy Watch 8 installation, real Data Layer background wake-up, Bluetooth reconnection, physical vibration, DND/permissions, round-screen readability and notification delivery need device verification.

**Web background push is not active:** the Firebase service-account file and four public Android Firebase configuration values are absent. Data Layer and foreground server retrieval do not require that configuration. See [setup and deployment](../../WATCH-INTEGRATION.md) for the exact missing values and validation steps. Do not describe this release as end-to-end hardware/FCM verified.
