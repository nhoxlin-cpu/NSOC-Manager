# Work Area: restore on another VPS

Keep this ZIP outside the old VPS (download to your computer or separate storage). It contains password hashes, all business data and photos. Keep it private. It does not contain active login sessions. Existing account passwords still work after restore.

1. Extract the entire archive into a NEW, empty directory. Never extract over a running installation. Keep manifest.json and RESTORE.md beside app/.
2. Install Node.js 24.11.1 or a newer Node 24 patch. In app/, run: node scripts/verify-recovery.mjs
3. Run: node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('data/work-area.sqlite'); console.log(d.prepare('PRAGMA integrity_check').get()); d.close()"
   The result must be ok. All scan photos are inside this SQLite database.
4. Configure the NEW VPS service with working directory app/ and command node server.mjs. Set DB_PATH to the absolute path of app/data/work-area.sqlite, HOST=127.0.0.1, PORT=3000, NODE_ENV=production and APP_ORIGIN=https://YOUR-DOMAIN. Do not run create-user: restored accounts already exist.
5. Install/configure Caddy or your HTTPS proxy on the new VPS. Point the chosen domain to the new IP; allow 80/443 and proxy to 127.0.0.1:3000. Caddy can issue new certificates. Use deploy/Caddyfile as a reference. Recreate the Windows scheduled task or Linux service with access to the new directory; do not reuse old machine account names or absolute paths.
6. Check /api/health, sign in, and inspect MM, CKD, HS/Stock/Label, Cutting and Holding including photos and quantities before switching users over. Keep the old VPS offline/read-only during final migration to avoid two independent sets of new data.

This portable package includes application code, dependencies bundled in lib/public, APK and a consistent SQLite snapshot. It records the old origin for reference. OS, Node/Caddy binaries, TLS private keys, firewall, DNS credentials and machine-specific windows.json are deliberately not copied; recreate those for the new VPS. It is an application recovery package, not a full VPS disk image.

Create and download a new package regularly and after important imports. A copy left only on the old VPS cannot protect against losing that VPS. Test the steps on a spare VPS before relying on disaster recovery.
