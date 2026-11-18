# List sub heatsink

Open **List sub heatsink** from Home or the workspace menu. Search Sub Heatsink,
Code Heatsink, IC, descriptions or Model; camera lookup reads a single code.
The Model filter and 30-group pages keep the list usable on phones. Each group
retains its source sheet/row, IC positions, multiline codes/descriptions and actual
embedded PNG/JPEG photos. Missing source codes/photos are explicitly shown;
the importer never invents them.

Administrators can import XLSX up to 200 MB. Every sheet is validated in a bounded
worker before an atomic database transaction publishes the new lookup batch.
Merged source cells preserve group membership. Unrecognized sheets abort the
whole import rather than silently importing only the first sheet. Expanded ZIP
content is bounded to 800 MB; up to 300 sheets and 100,000 groups are supported.
Earlier batches remain in the database; this is independent of MM, scan history
and Holding inventory.

Authenticated viewers can search and view photos but cannot import. Online
lookups read the current server list. **Sync / download offline data** after an
import to make that version (including photos) available without a connection.
Import itself requires the server. No customer workbook or production data is
bundled in the public source or APK.

Phone 1.1.20 (version code 26) includes this screen. Automated browser/snapshot
checks cover offline lookup; native installation/update prompts still require a
physical Android device.

Each IC position displays vendor alternatives in source order (first arrow = vendor 1, second arrow = vendor 2). Radio choices allow one vendor per IC for on-screen comparison, without modifying inventory or the source workbook. Mismatched code/description counts show the original text instead of guessing pairs. Embedded photos appear inline and open in a larger dialog, including downloaded offline photos.

Search results show unique Sub Heatsink codes only. Changing Model immediately filters results; select a code to open only its matching source groups, IC choices and photos. Return to the list without losing the filter. Exact-code details and counts work in downloaded offline snapshots too.

Administrators use **Nhập file dữ liệu → Nhập List sub heatsink** to select the original XLSX (up to 200 MB), then confirm with **Nhập danh sách**. Upload controls are absent from the normal lookup page. The selected filename/size appears before upload. All sheets and embedded photos follow the existing atomic importer.
