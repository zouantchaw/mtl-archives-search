import { parseArgs } from 'node:util';
import { OUTPUT, abs, validateCompletion } from './gold-label-batch-002-contract.js';
const {values}=parseArgs({options:{output:{type:'string',default:OUTPUT},validate:{type:'boolean',default:true}}});
if(values.validate) console.log(JSON.stringify({status:'adjudication_valid',...validateCompletion(abs(values.output!))}));
