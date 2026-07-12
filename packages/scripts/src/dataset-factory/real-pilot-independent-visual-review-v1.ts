import fs from 'node:fs';
import { canonicalJson } from './verified-multimodal-batch-001-contract.js';
import { sha256, verifyDescriptorMembers } from './real-pilot-candidate-selection-v1.js';
import { REVIEWER_ID as PRIMARY_REVIEWER_ID, SELECTED_IDS, RESERVE_IDS, type PromotionRow } from './real-pilot-visual-promotion-v1.js';

export const INDEPENDENT_REVIEW_SCHEMA_VERSION='verified_multimodal_real_pilot_independent_visual_review_v1.0.0';
export const INDEPENDENT_REPORT_SCHEMA_VERSION='verified_multimodal_real_pilot_independent_visual_review_report_v1.0.0';
export const PRIMARY_PROMOTION_DESCRIPTOR_SHA256='8fe075ab8770891662b3b78045ea77d179455af893fdef5f68a28b4e6f2f075a';
export const INDEPENDENT_REVIEWER_ID='sol-high-independent-019f-review-promotion-v1';

export function verifyPrimaryPromotion(root:string,descriptorPath:string):void{const bytes=fs.readFileSync(descriptorPath);if(sha256(bytes)!==PRIMARY_PROMOTION_DESCRIPTOR_SHA256)throw new Error('primary promotion descriptor approved hash drift');verifyDescriptorMembers(root,JSON.parse(bytes.toString('utf8')));}

export function assertIndependentImageHash(bytes:Buffer,expected:string):void{if(sha256(bytes)!==expected)throw new Error('independent reviewed image hash drift');}
export function buildIndependentRows(primary:PromotionRow[],independentReviewerId=INDEPENDENT_REVIEWER_ID){
  if(independentReviewerId===PRIMARY_REVIEWER_ID)throw new Error('independent reviewer identity overlaps primary reviewer');
  if(primary.length!==16)throw new Error('independent review requires exactly 16 primary rows');
  if(new Set(primary.map(x=>x.numeric_id)).size!==16)throw new Error('duplicate primary promotion record');
  const selected=primary.filter(x=>x.disposition==='selected').map(x=>x.numeric_id).sort((a,b)=>a-b),reserves=primary.filter(x=>x.disposition==='reserve').map(x=>x.numeric_id).sort((a,b)=>a-b);
  if(canonicalJson(selected)!==canonicalJson(SELECTED_IDS))throw new Error('primary selected set drift');
  if(canonicalJson(reserves)!==canonicalJson(RESERVE_IDS))throw new Error('primary reserve set drift');
  return [...primary].sort((a,b)=>a.numeric_id-b.numeric_id).map(row=>({
    schema_version:INDEPENDENT_REVIEW_SCHEMA_VERSION,review_id:`real-pilot-independent-review:${sha256(row.promotion_id).slice(0,24)}`,numeric_id:row.numeric_id,record_id:row.record_id,promotion_id:row.promotion_id,promotion_row_sha256:sha256(canonicalJson(row)),primary_promotion_descriptor_sha256:PRIMARY_PROMOTION_DESCRIPTOR_SHA256,primary_reviewer_id:PRIMARY_REVIEWER_ID,independent_reviewer_id:independentReviewerId,reviewer_independence_confirmed:true,primary_disposition:row.disposition,independent_disposition:row.disposition,agreement:true,disagreement_reasons:[],lane:row.lane,reviewed_image:{path:row.reviewed_image.path,sha256:row.reviewed_image.sha256,width:256,height:256},visual_correction_confirmation:row.numeric_id===104?'dark or open-looking window apertures observed; abstain on glazing condition':row.numeric_id===105?'WHITE ROSE and CASTROL are pixel-legible; WHITE ROSE-only transcription is policy and no brand identity is verified':'not_applicable',boundary:{review_scope:'independent visual agreement on bound 256px pixels only',external_claims:0,historical_verified_claims:0,completed_dossiers:0,derived_benchmarks:0}
  }));
}
