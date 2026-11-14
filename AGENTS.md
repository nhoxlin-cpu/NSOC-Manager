# Work Area collaboration

Both Codex accounts have equal authority to complete requested work: implement, test, publish source to GitHub and deploy to the existing VPS. Do not hand deployment to the other account merely because it is named A or B.

Before editing or deploying, fetch current main and inspect the live source. Preserve concurrent changes by merging them into the working source. Recheck main and the files being replaced immediately before publication or deployment; reconcile if either changed. Work in separate branches or checkouts where available.

CKD two-code UI lives in `public/ckd.js`; workbook parsing and model/SO checks live in `lib/ckd.mjs` and `lib/xlsx-read.mjs`. `public/app.js` mounts CKD and `server.mjs` exposes authenticated CKD routes. Preserve the independent Scan, Stock, MM and account workflows when changing shared files.

Run `node --test tests/*.test.mjs` and browser checks relevant to the changed workflow. Back up the live database and files before deploying; restart only Work Area. Do not replace the database or reset user accounts as part of a code update.

Every user-facing report must be ready to share with management. Use `reportWorkbook` and the shared `lib/report-layout.mjs` styles: branded title, scope, exporter, GMT+7 timestamp, numeric/date formats, column widths, frozen/filterable headings, status colors and print layout. Keep identifiers as text and preserve decimal quantities. The plain `excel` helper is for raw fixtures or data interchange, not finished reports. CKD reports include an overview; ZIP reports include relative photo links and extraction instructions.

All data-export buttons produce reports, including HS, Stock, Label, CKD and Holding. Include an overview and sequential STT on record sheets; embed available scan evidence with valid drawing relationships. Show real zero quantities as 0 and retain decimal precision. Import templates (MM CSV and AI/MI XLSX) must remain machine-readable, with their original first-row columns. Verify report/image compatibility using an independent workbook reader when changing shared report packaging; do not rely only on inspecting embedded image bytes.

CKD report detail columns must include STT, Samsung, ITEM, QTY, Đủ/Dư/Thiếu, Vendor, both captured images, scanner and GMT+7 scan time. Embed image previews in Excel via `lib/report-images.mjs`; keep original images in the ZIP. CKD popup codes and MOQ are edited with pencils and recalculate automatically. Do not require users to enter unique box IDs; use the request ID internally for idempotency.

This repository is public. Never commit uploaded workbooks, production data, photos, databases, credentials, real environment configuration or private deployment reports.

Holding v2 lives in `lib/holding.mjs` and `public/holding.js`. Reference Stock 32 imports are independent of MM and Scan Stock. Preserve per-box metadata snapshots, the active-barcode unique index, partial/full issue audit, request idempotency and per-account location preferences. Only actual intake adds inventory; importing PBA32/PMD32 reference files must never add boxes. Legacy Holding tables remain for recovery; legacy writes are disabled. Reports use four sheets (overview, ITEM totals, barcode inventory, audit) and the active inventory filters. Do not upload customer reference files to GitHub.

Holding cabinet edits require a reason, an expected entry revision and idempotent request ID. Adjust remaining QTY, never rewrite the original intake QTY. Keep immutable before/after event snapshots so changing a barcode, ITEM or Location cannot rewrite past receipts/issues. Migration backfills old event snapshots from their stored balances without changing current inventory. Photo dialogs and barcode rows expose both Issue stock and Edit data to writers; viewers remain read-only.

The ITEM view supports selecting multiple boxes to change only their common ITEM code and/or Location. Group edits are one atomic transaction, require a reason and each selected box's revision/membership, and retain a separate audited edit for every changed box. Keep quantities, box counts, barcodes and unselected boxes unchanged. Retry the group request idempotently even if the original response was lost after boxes moved to a different ITEM. Never implement this as independent client-side POSTs per box.

HS uses the shared `public/hs-code.js` normalizer at the camera and server: 12 characters ending in two letters or 13 ending in three, before the lot separator or numeric tail. Preserve the original label in `scans.raw_barcode`. Frame suppression uses the raw label so different lots with the same HS code still save distinct occurrences. Barcode ROI must stay horizontal, including saved layouts; QR stays square. Tap focus must distinguish a tap from moving/resizing/pinching and degrade honestly on unsupported hardware.

CKD history deletion is admin-only and scoped to one selected workbook/SO. Selected deletion is atomic; delete-all uses a confirmed maximum-ID cutoff to preserve later scans. Cascade evidence photos, recalculate live totals, preserve SO/model data, and retain deleted request IDs to block stale-save resurrection. Allocate new check IDs above both live and deleted IDs.
