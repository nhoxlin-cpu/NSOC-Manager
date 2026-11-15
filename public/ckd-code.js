// CKD camera routing only: warehouse Barcode-no must never fill the ITEM slot.
export function ckdCode(value){
 const code=String(value??'').trim().replace(/^\*|\*$/g,'').replace(/\s+/g,'').toUpperCase();
 if(/^(?:BN|AH)\d{2}-\d{5,6}[A-Z][A-Z0-9]*$/.test(code))return {slot:'samsung',code};
 if(/^(?:\d{10}[A-Z]{2}|\d{9}[A-Z]{3}|\d{11}[A-Z]{2}|\d{10}[A-Z]{3})$/.test(code))return {slot:'item',code};
 return null;
}
