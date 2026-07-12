import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256, verifyDescriptorMembers, type CandidateRow, type Lane } from './real-pilot-candidate-selection-v1.js';
import { canonicalJson } from './verified-multimodal-batch-001-contract.js';

export const PROMOTION_SCHEMA_VERSION = 'verified_multimodal_real_pilot_visual_promotion_v1.0.0';
export const PROMOTION_REPORT_SCHEMA_VERSION = 'verified_multimodal_real_pilot_visual_promotion_report_v1.0.0';
export const INPUT_DESCRIPTOR_SHA256 = '7c3729108057b374f2a108d0e3f556abcbec402d071b89268269c71340f9b96f';
export const REVIEWER_ID = 'sol-high-primary-019f57f4-0222-7750-8a88-330fdf3a74cc';
export const SELECTED_IDS = [0, 10, 100, 101, 102, 105, 8132, 8134, 8139, 8143, 10145, 11118] as const;
export const RESERVE_IDS = [103, 104, 10595, 11045] as const;
export const ALLOWED_IDS = [...SELECTED_IDS, ...RESERVE_IDS].sort((a, b) => a - b);

type Decision = {
  numeric_id: number;
  disposition: 'selected' | 'reserve';
  visually_observed_scene_elements: string[];
  lane_confirmation: string;
  evidence_opportunities: string[];
  hard_control_role: string;
  explicit_uncertainties_and_abstentions: string[];
  resolution_limitations: string;
};

const d = (numeric_id: number, disposition: Decision['disposition'], visually_observed_scene_elements: string[], lane_confirmation: string, evidence_opportunities: string[], hard_control_role: string, explicit_uncertainties_and_abstentions: string[]): Decision => ({
  numeric_id, disposition, visually_observed_scene_elements, lane_confirmation, evidence_opportunities, hard_control_role, explicit_uncertainties_and_abstentions,
  resolution_limitations: 'Direct review used only the bound 256x256 derivative; fine text, exact identity, date, location, scale, and georeference are not established by these pixels.',
});

export const VISUAL_DECISIONS: Decision[] = [
  d(0,'selected',['urban street','multi-storey commercial buildings','multiple facade and billboard signs','streetcar tracks'], 'ground scene with sign-rich built frontage', ['higher-resolution sign transcription','source-backed entity and place verification'], 'sign-rich positive visual control', ['Magic Baking Powder text is not pixel-confirmed at 256px','no entity, place, or historical claim is verified']),
  d(10,'selected',['street intersection','corner commercial building','storefront signs','utility poles and overhead wires'], 'ground street scene with visible commercial signage', ['higher-resolution storefront transcription','source-backed place verification'], 'ground signage diversity control', ['individual business names are not reliably legible at 256px']),
  d(100,'selected',['large multi-storey building under construction','scaffolding or exposed structural framework','street foreground'], 'ground architectural scene', ['construction-stage comparison','source-backed building and location verification'], 'low-text ground control', ['building identity and construction date are not pixel-verified']),
  d(101,'selected',['broad street','row buildings','pedestrians','deep awning foreground'], 'ground streetscape', ['storefront or streetscape comparison','source-backed location verification'], 'ground context control', ['sign text and named businesses are not reliably legible']),
  d(102,'selected',['masonry church-like building','tower or steeple','trees','parked automobile'], 'ground architectural scene', ['architectural feature review','source-backed building and address verification'], 'ground architecture control', ['church identity, address, and date are not pixel-verified']),
  d(105,'selected',['service-station-like forecourt','large roadside signs','pixel-legible WHITE ROSE and CASTROL text','street traffic and pedestrians','large industrial or commercial building'], 'ground scene with prominent sign surfaces', ['higher-resolution sign transcription','source-backed business and location verification'], 'partial-transcription policy hard control', ['WHITE ROSE is the sole promoted transcription by policy even though CASTROL is also pixel-legible at 256px','neither WHITE ROSE nor CASTROL is promoted to a brand identity','other sign text and entities are abstained']),
  d(10145,'selected',['printed map sheet','colored coverage grid','legend and index markings'], 'aerial/control lane confirmed as a non-photographic map/index control', ['future map-sheet interpretation with source documentation'], 'non-photographic map/index control', ['not an aerial photograph','map labels, coverage meaning, year, scale, and georeference are not pixel-verified']),
  d(11118,'selected',['very dark low-contrast frame','small indistinct light-toned area','border annotation block'], 'aerial/control lane retained as low-information input', [], 'low-information abstention control', ['abstain from scene, land-use, object, location, scale, and georeference interpretation']),
  d(8132,'selected',['aerial view','wide water body','shorelines and islands','dense street fabric'], 'aerial photograph confirmed visually', ['shoreline and urban-form comparison','future georeference with external control points'], 'water-and-urban-form aerial control', ['no named water body, island, location, scale, area, distance, or date is pixel-verified']),
  d(8134,'selected',['aerial view','runways or airfield-like linear surfaces','roads','mixed open and built areas'], 'aerial photograph confirmed visually', ['transport-pattern comparison','future georeference with external control points'], 'airfield-pattern aerial control', ['airfield identity, location, scale, area, distance, and date are not pixel-verified']),
  d(8139,'selected',['aerial view','road network','open land','scattered buildings'], 'aerial photograph confirmed visually', ['road-network and land-cover comparison','future georeference with external control points'], 'mixed-land-cover aerial control', ['land use, location, scale, area, distance, and date are not pixel-verified']),
  d(8143,'selected',['aerial view','dense rectilinear street grid','built blocks','large linear corridor'], 'aerial photograph confirmed visually', ['urban-grid comparison','future georeference with external control points'], 'dense-urban aerial control', ['corridor type, location, scale, area, distance, and date are not pixel-verified']),
  d(103,'reserve',['detached masonry house','central entrance path','trees and lawn'], 'ground architectural scene', ['architectural comparison','source-backed identity and location verification'], 'ground architectural reserve', ['house identity, address, date, and occupants are not pixel-verified']),
  d(104,'reserve',['damaged church-like masonry structure','tower','dark or open-looking window apertures','utility wires'], 'ground architectural scene', ['damage-state comparison','source-backed building and event verification'], 'damaged-structure reserve control', ['abstain on whether glazing is present, absent, or damaged','building identity, cause of damage, location, and date are not pixel-verified']),
  d(10595,'reserve',['printed map sheet','colored coverage grid','legend and index markings'], 'aerial/control lane confirmed as a non-photographic map/index control', ['future map-sheet interpretation with source documentation'], 'map/index reserve control', ['not an aerial photograph','map labels, coverage meaning, year, scale, and georeference are not pixel-verified']),
  d(11045,'reserve',['printed map sheet','colored coverage grid','legend and index markings'], 'aerial/control lane confirmed as a non-photographic map/index control', ['future map-sheet interpretation with source documentation'], 'map/index reserve control', ['not an aerial photograph','map labels, coverage meaning, year, scale, and georeference are not pixel-verified']),
].sort((a,b) => a.numeric_id-b.numeric_id);

export type PromotionRow = ReturnType<typeof promoteRows>[number];

export function verifyInputDescriptor(root: string, descriptorPath: string): void {
  const bytes = fs.readFileSync(descriptorPath);
  if (sha256(bytes) !== INPUT_DESCRIPTOR_SHA256) throw new Error('input candidate descriptor approved hash drift');
  const descriptor = JSON.parse(bytes.toString('utf8'));
  verifyDescriptorMembers(root, descriptor);
}

export function promoteRows(candidates: CandidateRow[]) {
  const byId = new Map(candidates.map((row) => [row.numeric_id, row]));
  if (candidates.length !== 26) throw new Error('candidate input row count mismatch');
  if (new Set(candidates.map((row) => row.numeric_id)).size !== candidates.length) throw new Error('duplicate candidate numeric id');
  if (VISUAL_DECISIONS.length !== 16 || new Set(VISUAL_DECISIONS.map(x=>x.numeric_id)).size !== 16) throw new Error('visual decision membership mismatch');
  if (JSON.stringify(VISUAL_DECISIONS.map(x=>x.numeric_id).sort((a,b)=>a-b)) !== JSON.stringify(ALLOWED_IDS)) throw new Error('visual decision allowed-id mismatch');
  const seenComponents=new Set<string>(), seenSources=new Set<string>(), seenPayloads=new Set<string>();
  const rows = VISUAL_DECISIONS.map((decision) => {
    const c = byId.get(decision.numeric_id); if (!c) throw new Error(`allowed candidate missing: ${decision.numeric_id}`);
    if (seenComponents.has(c.component_id)) throw new Error('duplicate promoted component'); seenComponents.add(c.component_id);
    if (seenSources.has(c.source_identity_sha256)) throw new Error('duplicate promoted source'); seenSources.add(c.source_identity_sha256);
    const payloads=[c.derivative.sha256,c.payload_identities.normalized_pixel_sha256,c.payload_identities.recovered_payload_sha256].filter((x):x is string=>Boolean(x));
    if(payloads.some(x=>seenPayloads.has(x))) throw new Error('duplicate promoted payload'); payloads.forEach(x=>seenPayloads.add(x));
    return { schema_version:PROMOTION_SCHEMA_VERSION, promotion_id:`real-pilot-visual-promotion:${crypto.createHash('sha256').update(c.candidate_id).digest('hex').slice(0,24)}`, record_id:c.record_id, candidate_id:c.candidate_id, component_id:c.component_id, source_identity_sha256:c.source_identity_sha256, input_candidate_descriptor_sha256:INPUT_DESCRIPTOR_SHA256, identity_hashes:{record_identity_sha256:sha256(c.record_id),candidate_row_sha256:sha256(canonicalJson(c)),component_identity_sha256:sha256(c.component_id),source_identity_sha256:c.source_identity_sha256}, image_hashes:{derivative_sha256:c.derivative.sha256,normalized_pixel_sha256:c.payload_identities.normalized_pixel_sha256,recovered_payload_sha256:c.payload_identities.recovered_payload_sha256}, lane:c.lane, ...decision, reviewer_id:REVIEWER_ID, reviewed_image:{path:c.derivative.path,sha256:c.derivative.sha256,width:c.derivative.width,height:c.derivative.height}, proxy_vs_verified_boundary:{candidate_proxy:'candidate metadata and lane markers remain unverified acquisition proxies',visual_review:'scene elements are direct visual observations from the bound 256px derivative only',historical_verification:'none; external/source-backed verification has not started',verified_claim_count:0}, historical_verification_status:'not_started', dossier_status:'not_started', benchmark_status:'not_derived' };
  });
  const selected=rows.filter(x=>x.disposition==='selected'), reserves=rows.filter(x=>x.disposition==='reserve');
  const selectedIds=selected.map(x=>x.numeric_id).sort((a,b)=>a-b), reserveIds=reserves.map(x=>x.numeric_id).sort((a,b)=>a-b);
  if(JSON.stringify(selectedIds)!==JSON.stringify(SELECTED_IDS)) throw new Error('exact selected id set invariant failed');
  if(JSON.stringify(reserveIds)!==JSON.stringify(RESERVE_IDS)) throw new Error('exact reserve id set invariant failed');
  for(const lane of ['ground_ocr_entity_place','aerial_land_use_georeference'] as Lane[]) if(selected.filter(x=>x.lane===lane).length!==6) throw new Error('selected lane balance invariant failed');
  return rows;
}
