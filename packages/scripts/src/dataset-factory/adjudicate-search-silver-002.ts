import { parseArgs } from 'node:util';import { OUTPUT,abs,validateSearchRows } from './gold-label-batch-002-contract.js';
const {values}=parseArgs({options:{output:{type:'string',default:OUTPUT}}});const result=validateSearchRows(abs(values.output!));console.log(JSON.stringify({status:'search_adjudication_valid',authority:result.authority.length,rows:result.rows.length}));
