import {inflateSync} from 'fflate';
export const inflateRawSync=bytes=>Buffer.from(inflateSync(bytes));
