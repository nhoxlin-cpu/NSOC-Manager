import {sha256} from '@noble/hashes/sha2.js';
export function createHash(name){if(name!=='sha256')throw Error('Unsupported hash');const chunks=[];return {update(value){chunks.push(Buffer.from(value));return this;},digest(format){const bytes=Buffer.from(sha256(Buffer.concat(chunks)));return format?bytes.toString(format):bytes;}};}
