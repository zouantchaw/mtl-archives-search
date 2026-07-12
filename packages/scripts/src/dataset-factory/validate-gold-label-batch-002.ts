import { parseArgs } from 'node:util';
import { OUTPUT, abs, validateCompletion } from './gold-label-batch-002-contract.js';
const {values}=parseArgs({options:{output:{type:'string',default:OUTPUT}}});console.log(JSON.stringify({status:'complete',...validateCompletion(abs(values.output!))}));
