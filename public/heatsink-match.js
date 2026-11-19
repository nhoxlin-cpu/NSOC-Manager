export const markingWords=value=>String(value||'').normalize('NFKC').toUpperCase().trim().split(/\s+/u).filter(Boolean).slice(0,20);
export function markingMatches(value,query){const words=markingWords(query),text=String(value||'').normalize('NFKC').toUpperCase();return words.length>0&&words.every(word=>text.includes(word));}
