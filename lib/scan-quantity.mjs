// Only explicit, unambiguous QTY fields count. Never interpret part numbers or MOQ as quantities.
export function scanQuantity(barcode,mode) {
  if(mode!=='Stock')return null;
  if([...String(barcode).matchAll(/(?:^|[\s;|,])(?:QTY|QUANTITY)\s*[:=]/gi)].length!==1)return null;
  const values=[...String(barcode).matchAll(/(?:^|[\s;|,])(?:QTY|QUANTITY)\s*[:=]\s*([0-9]+)(?=$|[\s;|]|,(?!\d))/gi)].map(m=>Number(m[1]));
  if(values.length!==1 || !Number.isSafeInteger(values[0]) || values[0]<1 || values[0]>1_000_000_000)return null;
  return values[0];
}
