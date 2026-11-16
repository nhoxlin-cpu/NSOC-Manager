# Work Area APK updates

The Online + Offline phone APK checks `/api/app-release` after startup, on returning to the app (at most once per hour), and when connectivity returns. A newer version produces a dismissible in-app banner. Downloads & Backup contains **Cập nhật ứng dụng** and a manual check. Offline checks fail quietly and never block scans. No background notification service or silent installation is claimed.

The user confirms download, then Android confirms installation. Android may first require **Allow installs from Work Area**. The native updater uses HTTPS on the fixed Work Area origin, refuses redirects, limits download size, verifies SHA-256/length, and checks package ID, strictly increasing version code and the existing release signing certificate before opening the installer. FileProvider exposes only the private update cache; the app database and scan outbox are never cleared. Declining an update leaves the current app usable.

Existing versions before 1.1.5 must be updated once using the normal APK link. They do not contain the native updater. Subsequent versions can use the in-app flow. Web/PWA users see the APK download option; their web shell continues to use the existing atomic service-worker update mechanism. The older APK Online package and Watch APK are not silently replaced by this phone updater.

## Publishing each future version

1. Increase `versionCode`/`versionName` in `android-offline/app/build.gradle`.
2. Update matching `public/android-release.json` plus the offline build version and release notes. `tests/app-release.test.mjs` rejects metadata/build-version mismatches.
3. Rebuild the coherent web shell and the signed phone APK with the existing private keystore. Never create a replacement signing key for an update.
4. Deploy metadata, `public/downloads/WorkArea-Offline-1.0.0.apk`, public sources and web shell together using the Work Area updater. The download filename remains stable; the API reports the actual new version and hashes actual APK bytes.
5. Verify `/api/app-release`, download SHA-256 and `apksigner verify`. Test a real Android old-to-new install, canceled install, install permission flow and preservation of queued scans.

Automated checks cover metadata/digest invalidation, version consistency, old/current-version UI, dismissal, native bridge dispatch and offline behavior. APK build/signature checks run separately. Browser bridge fixtures do not emulate Android's package installer: installation/permission prompts and an old-to-new update still require testing on a physical phone.
