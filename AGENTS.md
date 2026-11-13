# Work Area collaboration

Both Codex accounts have equal authority to complete requested work: implement, test, publish source to GitHub and deploy to the existing VPS. Do not hand deployment to the other account merely because it is named A or B.

Before editing or deploying, fetch current main and inspect the live source. Preserve concurrent changes by merging them into the working source. Recheck main and the files being replaced immediately before publication or deployment; reconcile if either changed. Work in separate branches or checkouts where available.

CKD two-code UI lives in `public/ckd.js`; workbook parsing and model/SO checks live in `lib/ckd.mjs` and `lib/xlsx-read.mjs`. `public/app.js` mounts CKD and `server.mjs` exposes authenticated CKD routes. Preserve the independent Scan, Stock, MM and account workflows when changing shared files.

Run `node --test tests/*.test.mjs` and browser checks relevant to the changed workflow. Back up the live database and files before deploying; restart only Work Area. Do not replace the database or reset user accounts as part of a code update.

This repository is public. Never commit uploaded workbooks, production data, photos, databases, credentials, real environment configuration or private deployment reports.
