# Independent SO and CKD model imports

CKD now has separate **Nhập SO** and **Nhập CKD model list** inputs, plus independent source selectors. Each accepts an XLSX containing only its relevant sheet (18 MB existing limit). Header discovery scans sheets instead of requiring SO in Sheet1 and models in Sheet2. SO retains the original BN CODE / SELLING CODE columns; model list retains MATERIAL CODE / HS CODE, Description and MOQ.

`POST /api/ckd/import` accepts `kind: "so" | "models" | "combined"`; omitted kind keeps the legacy combined importer. SO import stores only orders, model import stores only models, and every import is an immutable version. `ckd_workbooks.kind` defaults to `combined` for existing data. Old combined files/checks are preserved.

Checks/saves accept `workbook_id` for the SO and `model_workbook_id` for the chosen catalog. Omitting the catalog ID retains legacy same-workbook lookup. A model-only workbook cannot be used as an SO, and a source with no models cannot be used as a catalog. Both the normal match and NG code suggestions use the selected catalog. Selling Qty, totals and reports remain scoped to the SO; saved snapshots retain their exact model content and catalog ID.

The UI remembers the selected catalog per account/SO in this browser/app. Legacy SOs default to their own embedded catalog; a new SO defaults to the newest standalone catalog. The same model version can be reused across multiple SOs. Choosing another source resets an incomplete scan pair. No model import rewrites old checks.

Imports require connectivity. After refreshing the offline snapshot, the same selected-source check/save business rules work offline; the source IDs travel with queued checks. Snapshot refresh is required to make newly imported source versions available on another device.

Phone version 1.1.6 contains the corresponding bundled UI/rules. Version 1.1.5 users can use **Downloads & Backup → Cập nhật ứng dụng** to install it. Rebuild/deploy the generated web shell, signed phone APK and matching android-release.json coherently. Test independent single-sheet imports, legacy combined files, NG hints, SO-specific totals, saved snapshot preservation and offline check rules.
