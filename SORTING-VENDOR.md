# Sorting vendor — YUWON pilot

Open **Sorting vendor** from the workspace menu or home page. Writers enter DATE, CODE, MODEL, DEFECT NAME, TOTAL SORT, QTY NG, optional NOTE and marking. Viewers can read and export.

QTY OK = TOTAL SORT − QTY NG. RATE DEFECT = QTY NG / TOTAL SORT. Totals use the combined NG and combined sorted quantity, rather than averaging row percentages. Quantities must be whole numbers; TOTAL SORT is positive and NG cannot exceed it.

History supports date and text filters. Excel exports the filtered results in chronological order with an overview and the **YUWON NRT** sheet: STT, DATE, CODE, MODEL, DEFECT NAME, TOTAL SORT, QTY NG, QTY OK, RATE DEFECT, NOTE, marking. Codes remain text, including leading zeroes. Dates and percentages are typed Excel cells.

A prepared offline workspace can save records durably and export a clearly marked provisional report. Synchronization rechecks permissions and replays requests idempotently. Sorting records are separate from inventory; entering a result does not change MM or Holding balances.

The pilot starts empty and supports YUWON. Reference screenshot rows are not seeded into the database.
