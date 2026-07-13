import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURE = path.join(ROOT, 'docs/dataset-factory/fixtures/ground-claim-adjudication-v1');
const SCHEMAS = path.join(ROOT, 'docs/dataset-factory/schemas/ground-claim-adjudication-v1');
const GATE_B = path.join(ROOT, 'docs/dataset-factory/fixtures/ground-authoritative-research-v1');
const VERSION = 'ground_claim_adjudication_v1.0.0';
const CREATED_AT = '2026-07-13T00:00:00.000Z';
const PRIMARY_ID = 'sol-medium-implementation-author-issue69-gate-c-v1';
const APPROVED_ADJUDICATOR_ID = '019f5cea-fa84-7da0-be11-29d272f96521';
const APPROVED_AUTHORITY_SHA256 = 'd97fafe4095dcbcdf80a19353af67728d3e85f5d5a5a7dd9c5bd5992ccd79fdf';
const AUTHORITY_FILE = 'independent-adjudication-v1.json';
const AUTHORITY_PATH = path.join(FIXTURE, AUTHORITY_FILE);
const GATE_B_COMMIT = 'eead4a62e519373e736a3914cd755fc41c3ece14';
const CLAIM_IDS = ['c0-lovell','c0-rpcq','c10-spelling','c100-date','c101-laphkas','c102-date-address','c105-tilden'];
const PIN_PATHS = [
  'docs/dataset-factory/fixtures/ground-authoritative-research-v1/capture-ledger-v1.json',
  'docs/dataset-factory/fixtures/ground-authoritative-research-v1/descriptor-v1.json',
  'docs/dataset-factory/fixtures/ground-authoritative-research-v1/manifest-v1.json',
  'docs/dataset-factory/fixtures/ground-authoritative-research-v1/pending-claims-v1.json',
  'docs/dataset-factory/fixtures/ground-authoritative-research-v1/source-graph-v1.json',
  'docs/dataset-factory/fixtures/ground-originals-v1/descriptor-v1.json',
  'docs/dataset-factory/fixtures/ground-originals-v1/reviewed-visual-transcriptions-v1.json',
];
const MEMBER_PATHS = ['claim-packets-v1.json','independent-adjudication-template-v1.json',AUTHORITY_FILE,'primary-review-seal-v1.json','primary-reviews-v1.json','sealed-inputs-v1.json','status-report-v1.json'];
const FIXTURE_PATHS = [...MEMBER_PATHS,'descriptor-v1.json'].sort();
const REGISTRY_PATH = path.join(ROOT,'docs/dataset-factory/artifact-registry.v0.jsonl');
const REGISTRY_ID = 'dfv0_ground_claim_adjudication_v1';
const FINAL_FILES = ['accepted-claims-v1.json','verified-dossiers-v1.json','benchmark-tasks-v1.jsonl','search-tasks-v1.jsonl'];

type Json = Record<string, any>;
const read = (p:string):any => JSON.parse(fs.readFileSync(p,'utf8'));
const bytes = (p:string):Buffer => fs.readFileSync(p);
const sha = (v:string|Buffer):string => crypto.createHash('sha256').update(v).digest('hex');
const canonical = (v:any):string => `${JSON.stringify(v, null, 2)}\n`;
const write = (p:string,v:any):void => { fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,canonical(v)); };
const memberBytes = (v:any):Buffer => Buffer.isBuffer(v)?v:Buffer.from(canonical(v));
const writeMember = (p:string,v:any):void => {fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,memberBytes(v));};
const pin = (p:string):Json => ({path:path.relative(ROOT,p).split(path.sep).join('/'),bytes:bytes(p).length,sha256:sha(bytes(p))});
const assert: (ok:any,msg:string)=>asserts ok = (ok,msg) => {if(!ok)throw new Error(msg);};
const unique = (xs:string[]):boolean => new Set(xs).size===xs.length;

const decisions:Record<string,Json> = {
  'c0-lovell':{disposition:'abstained',confidence:'low',rationale:'The only support is an unreviewed manual directory transcription. It does not independently establish the transcription or connect either listing to the photographed scene.',limitations:['No independently reviewed directory pixels are pinned.','No image region supports a Gillett, Magic, or Gazette identity.']},
  'c0-rpcq':{disposition:'held',confidence:'medium',rationale:'The marker-complete RPCQ observation supports the 1000 Saint-Antoine proposition as a source observation, but the unreviewed Lovell transcription supplies an unresolved 100 alternative and there is no second independent corroborating family.',limitations:['Marker matching proves bounded page content, not scene identity.','The 100 versus 1000 conflict is unresolved.']},
  'c10-spelling':{disposition:'held',confidence:'medium',rationale:'The claim accurately records a spelling conflict between two families, but the Lovell reading is an unreviewed manual transcription and neither spelling is independently corroborated for promotion.',limitations:['Toponymy rows do not corroborate the surname.','The City row and its item URL are one archive family.']},
  'c100-date':{disposition:'held',confidence:'medium',rationale:'The three named families expose incompatible date signals, but two are unreviewed manual catalogue transcriptions and the signals describe different events: construction, dossier range, and approximate photograph date.',limitations:['The date types are not interchangeable.','No exact photographed-scene date is independently corroborated.']},
  'c101-laphkas':{disposition:'rejected',confidence:'medium',rationale:'A 1927 locator may support Caron Building/Bleury after review, but it cannot support the negative phrase "not Osborne" for a 1947 scene. The claim overreaches its temporal and evidentiary boundary.',limitations:['The sole source is an unreviewed manual transcription.','No pinned evidence places or excludes Laphkas in the photographed scene.']},
  'c102-date-address':{disposition:'held',confidence:'medium',rationale:'Three authoritative families expose the stated date and address variants, but they do not independently corroborate one exact address or establish that every value describes the same building state and event.',limitations:['1001, 1101, and 1086 Osborne remain unresolved.','RPCQ document 105269 is one family across records 100 and 102.']},
  'c105-tilden':{disposition:'abstained',confidence:'low',rationale:'The whole scene visibly contains Tilden and HERTZ wording, while the formal independently reviewed crop transcriptions establish only WHITE ROSE and CATELLI. Neither the visible wording nor the unreviewed manual Lovell transcription establishes Lovell\'s exact 1130 Windsor-near-Dorchester proposition, a Tilden-Hertz corporate join, a billboard operator, or an address; the transport-only LAC lead is not evidence.',limitations:['Tilden and HERTZ wording is visible in the whole scene but is not a formal independently reviewed crop transcription.','The formal independently reviewed crops establish only WHITE ROSE and CATELLI literal text.','No pinned evidence establishes Lovell\'s exact 1130 Windsor-near-Dorchester directory proposition, a Tilden-Hertz corporate join, a billboard operator, or an address.']},
};

function schemaValidators(){
  const Ajv=Ajv2020Import as unknown as new(o:any)=>any; const ajv=new Ajv({allErrors:true,strict:false});
  (addFormatsImport as unknown as (a:any)=>void)(ajv);
  const files=['sealed-inputs','claim-packets','primary-reviews','review-seal','adjudication-template','completed-adjudication','status-report','descriptor'];
  return new Map(files.map(name=>[name,ajv.compile(read(path.join(SCHEMAS,`${name}.schema.v1.json`)))]));
}
function validateSchema(name:string,value:any,validators= schemaValidators()):void{
  const v=validators.get(name)!; assert(v(value),`${name} schema validation failed: ${JSON.stringify(v.errors)}`);
}
function sourceRows():Json[]{return read(path.join(GATE_B,'capture-ledger-v1.json')).sources;}
function graphFamilies():Map<string,Json>{return new Map(read(path.join(GATE_B,'source-graph-v1.json')).families.map((x:Json)=>[x.family_id,x]));}
function expectedInputs():Json{return {schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',sealed_at:CREATED_AT,gate_b_commit:GATE_B_COMMIT,pins:PIN_PATHS.map(p=>pin(path.join(ROOT,p))),claim_ids:CLAIM_IDS,source_family_graph_sha256:sha(bytes(path.join(GATE_B,'source-graph-v1.json')))};}
function expectedPackets(inputs:Json):Json{
  const pending=read(path.join(GATE_B,'pending-claims-v1.json')),sources=sourceRows(),bySource=new Map(sources.map((s:Json)=>[s.source_id,s])),families=graphFamilies();
  return {schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',sealed_inputs_sha256:sha(canonical(inputs)),claims:pending.claims.map((c:Json)=>{const ids=[...c.supporting_source_ids,...c.contradicting_source_ids];return {claim_id:c.claim_id,record_id:c.record_id,claim_text:c.claim_text,evidence_boundary:c.evidence_boundary,alternatives_and_limits:c.alternatives_and_limits,visual_reference:c.record_id===105?{scope:'regions',artifact_path:'docs/dataset-factory/fixtures/ground-originals-v1/reviewed-visual-transcriptions-v1.json',region_ids:['white-rose','catelli-egg-noodles'],note:'The whole scene visibly contains Tilden and HERTZ wording, but neither is promoted to a formal crop transcription. The only formal independently reviewed crop transcriptions establish WHITE ROSE and CATELLI literal text; none establishes the exact directory proposition, a corporate join, a billboard operator, or an address.'}:{scope:'none',artifact_path:null,region_ids:[],note:'No pinned visual region is proposition support for this claim.'},sources:ids.map(id=>{const s=bySource.get(id)!;return {source_id:id,relationship:c.supporting_source_ids.includes(id)?'supporting':'opposing',family_id:s.family_id,family_label:families.get(s.family_id)?.label,independence:s.independence,url:s.url,authority_tier:s.authority_tier,evidence_status:s.evidence.status,source_note:s.note,proposition:s.proposition,limitation:s.evidence.limitation,rights_policy:s.rights_policy};})};})};
}
function expectedPrimaryReviews(packets:Json):Json{return {schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',stage:'primary_review',reviewer:{identity:PRIMARY_ID,role:'implementation_author_and_primary_claim_reviewer',model_route:'sol_medium',independent_adjudicator:false},packet_sha256:sha(canonical(packets)),rows:packets.claims.map((p:Json)=>{const d=decisions[p.claim_id],support=p.sources.filter((s:Json)=>s.relationship==='supporting').map((s:Json)=>s.source_id),oppose=p.sources.filter((s:Json)=>s.relationship==='opposing').map((s:Json)=>s.source_id);return {claim_id:p.claim_id,disposition:d.disposition,confidence:d.confidence,rationale:d.rationale,supporting_evidence_source_ids:support,opposing_evidence_source_ids:oppose,independent_support_family_ids:[...new Set(p.sources.filter((s:Json)=>s.relationship==='supporting').map((s:Json)=>s.family_id))].sort(),family_independence_assessment:'Families are counted once; shared editions, registers, predecessor/item rows, duplicate URLs, and duplicate bodies cannot self-corroborate.',limitations:d.limitations,promotion_eligible:false,promotion_blockers:['fresh_independent_adjudication_missing','promotion_contract_not_satisfied']};})};}
function derivedCounts(rows:Json[]):Json{const counts={accepted:0,held:0,rejected:0,abstained:0,promotion_eligible:0,accepted_claim_outputs:0,verified_dossiers:0,benchmark_tasks:0,search_tasks:0};for(const row of rows){counts[row.disposition as keyof typeof counts]++;if(row.promotion_eligible)counts.promotion_eligible++;}return counts;}
function exactStrings(actual:string[],expected:string[],label:string):void{assert(unique(actual),`${label}: values must be unique`);assert(actual.length===expected.length&&actual.every((x,i)=>x===expected[i]),`${label}: exact ordered values differ`);}
function validateRowEvidence(row:Json,packet:Json,label:string,requireComplete:boolean):void{
  const packetSources=new Map<string,Json>(packet.sources.map((x:Json)=>[x.source_id,x])),supporting=new Set<string>(row.supporting_evidence_source_ids),opposing=new Set<string>(row.opposing_evidence_source_ids);
  for(const sourceId of supporting){const source=packetSources.get(sourceId);assert(source,`${label}: supporting source is not in sealed claim packet: ${sourceId}`);assert(source.relationship==='supporting',`${label}: source relationship swap for ${sourceId}`);assert(!opposing.has(sourceId),`${label}: source cannot be both supporting and opposing: ${sourceId}`);}
  for(const sourceId of opposing){const source=packetSources.get(sourceId);assert(source,`${label}: opposing source is not in sealed claim packet: ${sourceId}`);assert(source.relationship==='opposing',`${label}: source relationship swap for ${sourceId}`);assert(!supporting.has(sourceId),`${label}: source cannot be both supporting and opposing: ${sourceId}`);}
  if(requireComplete){exactStrings(row.supporting_evidence_source_ids,packet.sources.filter((x:Json)=>x.relationship==='supporting').map((x:Json)=>x.source_id),`${label} supporting sources`);exactStrings(row.opposing_evidence_source_ids,packet.sources.filter((x:Json)=>x.relationship==='opposing').map((x:Json)=>x.source_id),`${label} opposing sources`);}
  const derivedFamilies=[...new Set(row.supporting_evidence_source_ids.map((sourceId:string)=>packetSources.get(sourceId)!.family_id))].sort(),claimedFamilies=[...row.independent_support_family_ids].sort();
  assert(unique(row.independent_support_family_ids),`${label}: same-family alias or duplicate family count`);assert(claimedFamilies.length===derivedFamilies.length&&claimedFamilies.every((x:string,i:number)=>x===derivedFamilies[i]),`${label}: support family IDs must exactly derive from selected supporting sources`);
  assert(row.supporting_evidence_source_ids.length>0&&row.independent_support_family_ids.length>0,`${label}: disposition requires nonempty exact supporting evidence and family set`);
  if(row.disposition==='accepted'){assert(row.confidence==='medium'||row.confidence==='high',`${label}: accepted confidence must be medium or high`);}
  else if(row.disposition==='held'){assert(row.confidence==='low'||row.confidence==='medium',`${label}: held confidence must be low or medium`);}
  else if(row.disposition==='rejected'){assert(row.confidence==='medium'||row.confidence==='high',`${label}: rejected confidence must be medium or high`);}
  else {assert(row.disposition==='abstained'&&row.confidence==='low',`${label}: abstained disposition requires low confidence`);}
  if(row.confidence==='high')assert(row.independent_support_family_ids.length>=2,`${label}: high confidence requires at least two selected source families`);
}

function authored(authorityBytes=bytes(AUTHORITY_PATH)):Record<string,any>{
  const sealedInputs=expectedInputs(),packets=expectedPackets(sealedInputs),reviews=expectedPrimaryReviews(packets);
  const reviewSeal={schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',stage:'primary_review',status:'sealed',reviewer_identity:PRIMARY_ID,reviewer_role:'implementation_author_and_primary_claim_reviewer',independent_adjudicator:false,sealed_at:CREATED_AT,sealed_inputs_sha256:sha(canonical(sealedInputs)),packet_sha256:sha(canonical(packets)),reviews_sha256:sha(canonical(reviews)),row_count:7};
  const adjudicationTemplate={schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',stage:'independent_adjudication',status:'not_started',required_route:'fresh_sol_high',adjudicator_identity:null,adjudicator_role:null,independence_attestation:null,sealed_primary_review_sha256:sha(canonical(reviewSeal)),sealed_inputs_sha256:sha(canonical(sealedInputs)),rows:[]};
  assert(sha(authorityBytes)===APPROVED_AUTHORITY_SHA256,'approved authority byte/SHA substitution');
  const authority=JSON.parse(authorityBytes.toString('utf8'));
  const counts=derivedCounts(authority.rows);
  const report={schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',gate_status:'independent_adjudication_complete_no_promotion',promotion_policy:'gate_c_no_promotion_requires_new_pinned_reviewed_evidence_gate',plain_english:'Independent adjudication is complete and authoritative for the seven listed dispositions: four held, one rejected, and two abstained. It accepts and promotes no claim. Issue #69 remains open because there are no verified claims or dossiers and the 60-record / 25-dossier target is unmet.',counts,primary_reviewer_identity:PRIMARY_ID,independent_adjudicator_identity:APPROVED_ADJUDICATOR_ID,independent_adjudicator_review_session_id:APPROVED_ADJUDICATOR_ID,independent_adjudication_sha256:APPROVED_AUTHORITY_SHA256,independent_adjudication_authority:true,promotion_authority:false,issue_69_open:true,production_mutation:false,final_output_files_present:[]};
  const members:any={ 'sealed-inputs-v1.json':sealedInputs,'claim-packets-v1.json':packets,'primary-reviews-v1.json':reviews,'primary-review-seal-v1.json':reviewSeal,'independent-adjudication-template-v1.json':adjudicationTemplate,[AUTHORITY_FILE]:authorityBytes,'status-report-v1.json':report};
  const manifest=Object.entries(members).map(([p,v])=>({path:p,bytes:memberBytes(v).length,sha256:sha(memberBytes(v))})).sort((a,b)=>a.path.localeCompare(b.path));
  members['descriptor-v1.json']={schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',scope:'completed_independent_adjudication_authority_no_promotion',created_at:CREATED_AT,predecessor_artifact_id:'ground-authoritative-research-v1',authority_member:AUTHORITY_FILE,authority_sha256:APPROVED_AUTHORITY_SHA256,approved_adjudicator_identity:APPROVED_ADJUDICATOR_ID,approved_review_session_id:APPROVED_ADJUDICATOR_ID,manifest,tree_sha256:sha(`${manifest.map(x=>`${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`),production_mutation:false};
  return members;
}

function verifyCommitPins(inputs:Json):void{
  exactStrings(inputs.pins.map((x:Json)=>x.path),PIN_PATHS,'canonical predecessor pin paths');
  assert(canonical(inputs)===canonical(expectedInputs()),'sealed inputs differ from canonical predecessor pins');
  for(const p of inputs.pins){const commitBytes=execFileSync('git',['show',`${GATE_B_COMMIT}:${p.path}`],{cwd:ROOT,encoding:null,maxBuffer:2*1024*1024}) as Buffer;assert(commitBytes.length===p.bytes&&sha(commitBytes)===p.sha256,`Gate B commit blob mismatch: ${p.path}`);assert(commitBytes.equals(bytes(path.join(ROOT,p.path))),`working predecessor differs from Gate B commit: ${p.path}`);}
}
function treeStats(root:string):Json{let total=0;const rows=FIXTURE_PATHS.map(file=>{const value=bytes(path.join(root,file));total+=value.length;return `${file}\t${sha(value)}\t${value.length}`;});return {file_count:FIXTURE_PATHS.length,byte_count:total,digest:sha(`${rows.join('\n')}\n`)};}
function expectedDescriptor(root=FIXTURE):Json{return authored(bytes(path.join(root,AUTHORITY_FILE)))['descriptor-v1.json'];}
function verifyDescriptor(root:string,descriptor:Json):void{
  const actualFiles=fs.readdirSync(root).sort();exactStrings(actualFiles,FIXTURE_PATHS,'fixture file paths');
  exactStrings(descriptor.manifest.map((x:Json)=>x.path),MEMBER_PATHS,'descriptor member paths');
  for(const member of descriptor.manifest){const value=bytes(path.join(root,member.path));assert(value.length===member.bytes&&sha(value)===member.sha256,`descriptor member tamper: ${member.path}`);}
  const expectedTree=sha(`${descriptor.manifest.map((x:Json)=>`${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`);assert(descriptor.tree_sha256===expectedTree,'descriptor tree_sha256 drift');
  assert(canonical(descriptor)===canonical(expectedDescriptor(root)),'descriptor differs from complete authored descriptor');
}
function expectedRegistryRow(root=FIXTURE):Json{const generated=authored(bytes(path.join(root,AUTHORITY_FILE)));let byteCount=0,tree='';for(const file of FIXTURE_PATHS){const value=memberBytes(generated[file]);byteCount+=value.length;tree+=`${file}\t${sha(value)}\t${value.length}\n`;}const stats={file_count:FIXTURE_PATHS.length,byte_count:byteCount,digest:sha(tree)};return {stable_id:REGISTRY_ID,schema_version:'dataset_factory_artifact_registry_v0',artifact_schema_version:VERSION,artifact_kind:'directory',content_digest:{algorithm:'sha256',value:stats.digest,scope:'sorted_tree_manifest'},counts:{file_count:stats.file_count,byte_count:stats.byte_count},source_lineage:{description:'Tracked Issue #69 Gate C authority binding exactly seven Gate B pending claims to sealed predecessor pins, source-family evidence, seven implementation-author primary dispositions, the blank pre-review template, and the exact reviewer-authored independent adjudication approved under SHA-256 d97fafe4095dcbcdf80a19353af67728d3e85f5d5a5a7dd9c5bd5992ccd79fdf. The independent dispositions are authoritative, but promotion authority is false and the artifact emits zero accepted claims, verified dossiers, benchmark tasks, or search tasks.',source_artifact_ids:['dfv0_ground_authoritative_research_v1'],source_urls:['https://github.com/zouantchaw/mtl-archives-search/issues/69']},storage:{storage_class:'tracked_repository',path_class:'tracked_fixture',locator:'docs/dataset-factory/fixtures/ground-claim-adjudication-v1'},generation:{method:'review_assisted',command:'npm run dataset-factory:ground-claim-adjudication-publish-v1 -- /path/to/approved-independent-adjudication.json && npm run dataset-factory:ground-claim-adjudication-verify-v1 && npm run dataset-factory:ground-claim-adjudication-self-test-v1 && npm run dataset-factory:ground-claim-adjudication-integration-test-v1',code_ref:'codex/69-ground-claim-adjudication',human_input_ids:[]},dependency_ids:['dfv0_ground_authoritative_research_v1'],required_by:['issue #69 independent claim adjudication evidence'],rights_boundary:{license_id:'citation-and-official-public-source-boundary',attribution:'BAnQ, Ville de Montreal, Government of Quebec, Government of Canada, and named official institutions as recorded in Gate B.',commercial_use_allowed:false,notes:'Only source URLs, bounded notes, propositions, limitations, source-family relationships, and reviewer-authored adjudication text are tracked. No source body or publication scan is copied; no claim promotion or redistribution right is asserted.'},created_at:CREATED_AT,creation_time_basis:'report_metadata'};}
function verifyRegistry(root:string,registryPath=REGISTRY_PATH):void{
  const rows=fs.readFileSync(registryPath,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)),matches=rows.filter((x:Json)=>x.stable_id===REGISTRY_ID);assert(matches.length===1,'artifact registry stable ID missing or duplicated');const row=matches[0],stats=treeStats(root);
  assert(row.artifact_schema_version===VERSION,'artifact registry schema version drift');assert(row.artifact_kind==='directory','artifact registry kind drift');assert(row.storage?.locator==='docs/dataset-factory/fixtures/ground-claim-adjudication-v1'&&row.storage?.path_class==='tracked_fixture','artifact registry path drift');assert(canonical(row.dependency_ids)===canonical(['dfv0_ground_authoritative_research_v1'])&&canonical(row.source_lineage?.source_artifact_ids)===canonical(['dfv0_ground_authoritative_research_v1']),'artifact registry dependency drift');assert(row.counts?.file_count===stats.file_count&&row.counts?.byte_count===stats.byte_count,'artifact registry counts drift');assert(row.content_digest?.scope==='sorted_tree_manifest'&&row.content_digest?.value===stats.digest,'artifact registry digest drift');
  assert(canonical(row)===canonical(expectedRegistryRow(root)),'artifact registry row differs from complete canonical row');
}

function validateIndependentValue(value:Json,raw:Buffer,root:string,requireApprovedAuthority:boolean):Json{
  validateSchema('completed-adjudication',value);
  if(requireApprovedAuthority){
    assert(sha(raw)===APPROVED_AUTHORITY_SHA256,'approved authority byte/SHA substitution');
    assert(value.adjudicator.identity===APPROVED_ADJUDICATOR_ID,'approved adjudicator identity substitution');
    assert(value.adjudicator.review_session_id===APPROVED_ADJUDICATOR_ID,'approved adjudicator review session substitution');
  }
  const seal=read(path.join(root,'primary-review-seal-v1.json')),inputs=read(path.join(root,'sealed-inputs-v1.json')),packets=read(path.join(root,'claim-packets-v1.json'));
  assert(value.adjudicator.identity!==seal.reviewer_identity&&value.adjudicator.review_session_id!==seal.reviewer_identity,'adjudicator identity or session overlaps primary reviewer identity');
  assert(value.adjudicator.identity===value.adjudicator.review_session_id,'adjudicator identity must equal review_session_id');
  assert(value.sealed_primary_review_sha256===sha(canonical(seal)),'completed adjudication primary seal mismatch');
  assert(value.sealed_inputs_sha256===sha(canonical(inputs)),'completed adjudication input seal mismatch');
  const packetById=new Map<string,Json>(packets.claims.map((x:Json)=>[x.claim_id,x])),packetIds=packets.claims.map((x:Json)=>x.claim_id).sort(),ids=value.rows.map((x:Json)=>x.claim_id).sort();
  assert(ids.length===packetIds.length&&unique(ids)&&ids.every((x:string,i:number)=>x===packetIds[i]),'completed adjudication duplicate IDs, fabricated IDs, or missing packet claims');
  for(const row of value.rows){assert(row.disposition!=='accepted',`${row.claim_id}: accepted is forbidden in Gate C without independently reviewed external evidence`);validateRowEvidence(row,packetById.get(row.claim_id)!,`completed ${row.claim_id}`,true);assert(row.promotion_eligible===false&&row.promotion_contract===null,`${row.claim_id}: Gate C promotion is forbidden without a new pinned reviewed evidence gate`);}
  return derivedCounts(value.rows);
}

function semantic(root:string,verifyRegistryRow=root===FIXTURE,registryPath=REGISTRY_PATH):Json{
  const validators=schemaValidators(); const names:Record<string,string>={'sealed-inputs-v1.json':'sealed-inputs','claim-packets-v1.json':'claim-packets','primary-reviews-v1.json':'primary-reviews','primary-review-seal-v1.json':'review-seal','independent-adjudication-template-v1.json':'adjudication-template',[AUTHORITY_FILE]:'completed-adjudication','status-report-v1.json':'status-report','descriptor-v1.json':'descriptor'};
  const vals=new Map<string,any>(); for(const [file,name] of Object.entries(names)){const value=read(path.join(root,file));validateSchema(name,value,validators);vals.set(file,value);}
  const inputs=vals.get('sealed-inputs-v1.json'),packets=vals.get('claim-packets-v1.json'),reviews=vals.get('primary-reviews-v1.json'),seal=vals.get('primary-review-seal-v1.json'),template=vals.get('independent-adjudication-template-v1.json'),authority=vals.get(AUTHORITY_FILE),report=vals.get('status-report-v1.json'),descriptor=vals.get('descriptor-v1.json');
  verifyCommitPins(inputs);
  const canonicalPackets=expectedPackets(inputs);assert(canonical(packets)===canonical(canonicalPackets),'claim packets differ from complete canonical Gate B projection');
  exactStrings(packets.claims.map((x:Json)=>x.claim_id),CLAIM_IDS,'packet claim IDs');exactStrings(reviews.rows.map((x:Json)=>x.claim_id),CLAIM_IDS,'primary review claim IDs');
  assert(packets.sealed_inputs_sha256===sha(canonical(inputs)),'packet/input seal mismatch');assert(reviews.packet_sha256===sha(canonical(packets)),'review/packet seal mismatch');
  assert(seal.reviews_sha256===sha(canonical(reviews))&&seal.packet_sha256===sha(canonical(packets))&&seal.sealed_inputs_sha256===sha(canonical(inputs)),'primary review seal mismatch');
  assert(template.sealed_primary_review_sha256===sha(canonical(seal))&&template.sealed_inputs_sha256===sha(canonical(inputs)),'adjudication template seal mismatch');
  assert(template.status==='not_started'&&template.adjudicator_identity===null&&template.rows.length===0,'premature adjudication output');
  assert(reviews.reviewer.identity===seal.reviewer_identity&&!reviews.reviewer.independent_adjudicator,'reviewer identity/role mismatch');
  const packetById=new Map<string,Json>(packets.claims.map((x:Json)=>[x.claim_id,x]));for(const row of reviews.rows){validateRowEvidence(row,packetById.get(row.claim_id)!,`primary ${row.claim_id}`,true);assert(!row.promotion_eligible,`${row.claim_id}: unsupported promotion`);}
  assert(canonical(reviews)===canonical(expectedPrimaryReviews(packets)),'primary reviews differ from canonical sealed author decisions');
  const authorityCounts=validateIndependentValue(authority,bytes(path.join(root,AUTHORITY_FILE)),root,true);
  assert(canonical(report.counts)===canonical(authorityCounts),'status counts do not derive from approved independent authority');
  assert(report.independent_adjudicator_identity===APPROVED_ADJUDICATOR_ID&&report.independent_adjudicator_review_session_id===APPROVED_ADJUDICATOR_ID&&report.independent_adjudication_sha256===APPROVED_AUTHORITY_SHA256&&report.independent_adjudication_authority===true&&report.promotion_authority===false&&report.issue_69_open===true&&report.gate_status==='independent_adjudication_complete_no_promotion'&&report.promotion_policy==='gate_c_no_promotion_requires_new_pinned_reviewed_evidence_gate','status authority, identity, issue, or promotion policy drift');
  for(const f of FINAL_FILES)assert(!fs.existsSync(path.join(root,f)),`gated final output exists prematurely: ${f}`);
  verifyDescriptor(root,descriptor);if(verifyRegistryRow)verifyRegistry(root,registryPath);
  return report.counts;
}

function build(root=FIXTURE,authoritySource=AUTHORITY_PATH):Json{const authority=bytes(path.resolve(authoritySource));fs.mkdirSync(root,{recursive:true});for(const f of fs.readdirSync(root))fs.rmSync(path.join(root,f),{recursive:true,force:true});const members=authored(authority);for(const [p,v] of Object.entries(members))writeMember(path.join(root,p),v);return {status:'built',files:Object.keys(members).length,authority_sha256:sha(authority),...semantic(root,false)};}
function verify():Json{return {status:'verified',...semantic(FIXTURE)};}
function copyFixture():string{const d=fs.mkdtempSync(path.join(os.tmpdir(),'ground-claim-adjudication-'));fs.cpSync(FIXTURE,d,{recursive:true});return d;}
function mutate(label:string,fn:(root:string)=>void,re:RegExp):void{const d=copyFixture();try{fn(d);let e='';try{semantic(d);}catch(x){e=x instanceof Error?x.message:String(x);}assert(re.test(e),`${label}: expected rejection, got ${e}`);}finally{fs.rmSync(d,{recursive:true,force:true});}}
function reseal(root:string):void{
  const inputs=read(path.join(root,'sealed-inputs-v1.json')),packets=read(path.join(root,'claim-packets-v1.json')),reviews=read(path.join(root,'primary-reviews-v1.json')),seal=read(path.join(root,'primary-review-seal-v1.json')),template=read(path.join(root,'independent-adjudication-template-v1.json')),authority=read(path.join(root,AUTHORITY_FILE)),report=read(path.join(root,'status-report-v1.json'));
  packets.sealed_inputs_sha256=sha(canonical(inputs));write(path.join(root,'claim-packets-v1.json'),packets);reviews.packet_sha256=sha(canonical(packets));write(path.join(root,'primary-reviews-v1.json'),reviews);seal.sealed_inputs_sha256=sha(canonical(inputs));seal.packet_sha256=sha(canonical(packets));seal.reviews_sha256=sha(canonical(reviews));write(path.join(root,'primary-review-seal-v1.json'),seal);template.sealed_inputs_sha256=sha(canonical(inputs));template.sealed_primary_review_sha256=sha(canonical(seal));write(path.join(root,'independent-adjudication-template-v1.json'),template);report.counts=derivedCounts(authority.rows);write(path.join(root,'status-report-v1.json'),report);
  const descriptor=read(path.join(root,'descriptor-v1.json'));descriptor.manifest=MEMBER_PATHS.map(file=>({path:file,bytes:bytes(path.join(root,file)).length,sha256:sha(bytes(path.join(root,file)))}));descriptor.tree_sha256=sha(`${descriptor.manifest.map((x:Json)=>`${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`);write(path.join(root,'descriptor-v1.json'),descriptor);
}
function mutateResealed(label:string,fn:(root:string)=>void,re:RegExp):void{const d=copyFixture();try{fn(d);reseal(d);let error='';try{semantic(d);}catch(x){error=x instanceof Error?x.message:String(x);}assert(re.test(error),`${label}: expected coordinated reseal rejection, got ${error}`);}finally{fs.rmSync(d,{recursive:true,force:true});}}
function registryMutation(label:string,fn:(row:Json)=>void,re:RegExp):void{const registry=path.join(os.tmpdir(),`ground-claim-registry-${process.pid}-${label.replaceAll(' ','-')}.jsonl`);try{const rows=fs.readFileSync(REGISTRY_PATH,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)),row=rows.find((x:Json)=>x.stable_id===REGISTRY_ID)!;fn(row);fs.writeFileSync(registry,`${rows.map(x=>JSON.stringify(x)).join('\n')}\n`);let error='';try{verifyRegistry(FIXTURE,registry);}catch(x){error=x instanceof Error?x.message:String(x);}assert(re.test(error),`${label}: expected registry rejection, got ${error}`);}finally{fs.rmSync(registry,{force:true});}}
function resealRegistry():void{const rows=fs.readFileSync(REGISTRY_PATH,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)),index=rows.findIndex((x:Json)=>x.stable_id===REGISTRY_ID);assert(index>=0,'artifact registry row missing during publication');rows[index]=expectedRegistryRow();fs.writeFileSync(REGISTRY_PATH,`${rows.map(x=>JSON.stringify(x)).join('\n')}\n`);}
function syntheticCompletedAdjudication():Json{
  const seal=read(path.join(FIXTURE,'primary-review-seal-v1.json')),inputs=read(path.join(FIXTURE,'sealed-inputs-v1.json')),packets=read(path.join(FIXTURE,'claim-packets-v1.json'));
  return {schema_version:VERSION,artifact_id:'ground-claim-adjudication-v1',stage:'independent_adjudication',status:'sealed',adjudicator:{identity:'synthetic-independent-self-test-only',role:'fresh_independent_claim_adjudicator',model_route:'sol_high',review_session_id:'synthetic-independent-self-test-only'},independence_attestation:'I independently inspected the sealed inputs and primary review; I am not the implementation author or primary reviewer.',sealed_primary_review_sha256:sha(canonical(seal)),sealed_inputs_sha256:sha(canonical(inputs)),sealed_at:CREATED_AT,rows:packets.claims.map((packet:Json)=>{const supporting=packet.sources.filter((x:Json)=>x.relationship==='supporting');return {claim_id:packet.claim_id,disposition:'held',confidence:'low',rationale:'Synthetic self-test row; never real pilot authority.',supporting_evidence_source_ids:supporting.map((x:Json)=>x.source_id),opposing_evidence_source_ids:packet.sources.filter((x:Json)=>x.relationship==='opposing').map((x:Json)=>x.source_id),independent_support_family_ids:[...new Set(supporting.map((x:Json)=>x.family_id))].sort(),limitations:['Synthetic test only.'],promotion_eligible:false,promotion_contract:null};})};
}
function completedMutation(label:string,fn:(value:Json)=>void,re:RegExp):void{
  const file=path.join(os.tmpdir(),`ground-claim-completed-${process.pid}-${label.replaceAll(' ','-')}.json`);
  try{const value=syntheticCompletedAdjudication();fn(value);write(file,value);let error='';try{validateIndependentValue(value,bytes(file),FIXTURE,false);}catch(x){error=x instanceof Error?x.message:String(x);}assert(re.test(error),`${label}: expected rejection, got ${error}`);}finally{fs.rmSync(file,{force:true});}
}
function authorityValueMutation(label:string,fn:(value:Json)=>void,requireApprovedAuthority:boolean,re:RegExp):void{const raw=bytes(AUTHORITY_PATH),value=JSON.parse(raw.toString('utf8'));fn(value);let error='';try{validateIndependentValue(value,raw,FIXTURE,requireApprovedAuthority);}catch(x){error=x instanceof Error?x.message:String(x);}assert(re.test(error),`${label}: expected authority rejection, got ${error}`);}
function selfTest():Json{
  mutate('tampering',r=>fs.appendFileSync(path.join(r,'primary-reviews-v1.json'),' '),/tamper|seal mismatch/);
  mutate('hash pin drift',r=>{const x=read(path.join(r,'sealed-inputs-v1.json'));x.pins[0].sha256='a'.repeat(64);write(path.join(r,'sealed-inputs-v1.json'),x);},/sealed inputs differ|pin drift|seal mismatch/);
  mutateResealed('duplicate predecessor pin',r=>{const x=read(path.join(r,'sealed-inputs-v1.json'));x.pins[1]=structuredClone(x.pins[0]);write(path.join(r,'sealed-inputs-v1.json'),x);},/canonical predecessor pin paths/);
  mutateResealed('omitted predecessor pin',r=>{const x=read(path.join(r,'sealed-inputs-v1.json'));x.pins.pop();write(path.join(r,'sealed-inputs-v1.json'),x);},/schema validation|canonical predecessor pin paths/);
  mutateResealed('substituted predecessor pin',r=>{const x=read(path.join(r,'sealed-inputs-v1.json'));x.pins[0]=pin(path.join(ROOT,'package.json'));x.pins.sort((a:Json,b:Json)=>a.path.localeCompare(b.path));write(path.join(r,'sealed-inputs-v1.json'),x);},/canonical predecessor pin paths/);
  mutate('schema bypass',r=>{const x=read(path.join(r,'status-report-v1.json'));x.extra=true;write(path.join(r,'status-report-v1.json'),x);},/schema validation/);
  mutate('duplicate IDs',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[1].claim_id=x.claims[0].claim_id;write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection|duplicate IDs|seal mismatch/);
  mutate('missing claim',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows.pop();write(path.join(r,'primary-reviews-v1.json'),x);},/schema validation|missing claims|seal mismatch/);
  mutate('fabricated source',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[0].sources[0].source_id='fabricated';write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection|fabricated source|seal mismatch/);
  mutate('transport-only evidence',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[0].sources[0].source_id='r0-lovell-lead';write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection|not_evidence|seal mismatch/);
  mutate('marker incomplete evidence',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[1].sources[0].evidence_status='marker_incomplete';write(path.join(r,'claim-packets-v1.json'),x);},/schema validation|complete canonical Gate B projection|fabrication|seal mismatch/);
  mutate('same family double count',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows[0].independent_support_family_ids.push(x.rows[0].independent_support_family_ids[0]);write(path.join(r,'primary-reviews-v1.json'),x);},/schema validation|same-family|seal mismatch/);
  mutateResealed('coordinated packet record',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[0].record_id=10;write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection/);
  mutateResealed('coordinated packet source omission',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[1].sources.pop();write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection/);
  mutateResealed('coordinated packet relationship',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[1].sources[0].relationship='opposing';write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection/);
  mutateResealed('coordinated packet source property',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[0].sources[0].rights_policy='forged rights';write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection/);
  mutateResealed('coordinated packet claim order',r=>{const x=read(path.join(r,'claim-packets-v1.json'));[x.claims[0],x.claims[1]]=[x.claims[1],x.claims[0]];write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection|packet claim IDs/);
  mutateResealed('coordinated primary source omission',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows[0].supporting_evidence_source_ids=[];x.rows[0].independent_support_family_ids=[];write(path.join(r,'primary-reviews-v1.json'),x);},/exact ordered values differ|disposition requires nonempty|canonical sealed author decisions/);
  mutateResealed('coordinated primary relationship swap',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));const row=x.rows[1];row.opposing_evidence_source_ids.push(row.supporting_evidence_source_ids.pop());row.independent_support_family_ids=[];write(path.join(r,'primary-reviews-v1.json'),x);},/relationship swap/);
  mutateResealed('coordinated primary family',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows[0].independent_support_family_ids=['fabricated-family'];write(path.join(r,'primary-reviews-v1.json'),x);},/exactly derive/);
  mutateResealed('coordinated primary disposition count',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows[0].disposition='held';x.rows[0].confidence='medium';write(path.join(r,'primary-reviews-v1.json'),x);},/canonical sealed author decisions/);
  completedMutation('identity overlap',x=>{x.adjudicator.identity=PRIMARY_ID;},/overlaps primary/);
  completedMutation('identity session mismatch',x=>{x.adjudicator.review_session_id='different-session';},/identity must equal review_session_id/);
  completedMutation('session overlap',x=>{x.adjudicator.identity=PRIMARY_ID;x.adjudicator.review_session_id=PRIMARY_ID;},/identity or session overlaps primary/);
  completedMutation('completed fabricated source',x=>{x.rows[0].supporting_evidence_source_ids.push('fabricated-source');},/not in sealed claim packet/);
  completedMutation('completed relationship swap',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c0-rpcq');row.supporting_evidence_source_ids=[];row.independent_support_family_ids=[];row.opposing_evidence_source_ids.push('r0-rpcq-gazette');},/relationship swap/);
  completedMutation('completed fabricated family',x=>{x.rows[0].independent_support_family_ids.push('fabricated-family');},/must exactly derive/);
  completedMutation('completed omitted selected family',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c10-spelling');row.independent_support_family_ids.pop();},/must exactly derive/);
  completedMutation('completed omitted sole opposing source c0-rpcq',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c0-rpcq');row.opposing_evidence_source_ids=[];},/opposing sources: exact ordered values differ/);
  completedMutation('completed omitted supporting source and family c100-date',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c100-date');row.supporting_evidence_source_ids.pop();row.independent_support_family_ids=row.independent_support_family_ids.filter((id:string)=>id!=='banq-armour-landry-3232855');},/supporting sources: exact ordered values differ/);
  completedMutation('completed omitted family retaining source c100-date',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c100-date');row.independent_support_family_ids.pop();},/must exactly derive/);
  completedMutation('completed omitted source retaining family c100-date',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c100-date');row.supporting_evidence_source_ids.pop();},/supporting sources: exact ordered values differ/);
  completedMutation('completed coordinated supporting opposing subset omissions',x=>{const supportRow=x.rows.find((v:Json)=>v.claim_id==='c100-date');supportRow.supporting_evidence_source_ids.pop();supportRow.independent_support_family_ids=supportRow.independent_support_family_ids.filter((id:string)=>id!=='banq-armour-landry-3232855');const opposingRow=x.rows.find((v:Json)=>v.claim_id==='c0-rpcq');opposingRow.opposing_evidence_source_ids=[];},/supporting sources: exact ordered values differ|opposing sources: exact ordered values differ/);
  completedMutation('completed same-family alias double count',x=>{x.rows[0].independent_support_family_ids.push(x.rows[0].independent_support_family_ids[0]);},/schema validation|same-family alias/);
  completedMutation('completed source outside claim packet',x=>{x.rows[0].supporting_evidence_source_ids.push('r105-lovell-1944');},/not in sealed claim packet/);
  completedMutation('completed plausible promotion forbidden',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c10-spelling');row.disposition='accepted';row.promotion_eligible=true;row.promotion_contract={evidence_boundary:'plausible',visual_reference:'whole image',authoritative_source_urls_and_notes:['https://example.com/a','https://example.com/b'],alternatives:['other'],confidence:'high',rights:'claimed',independent_corroboration_note:'two real families'};},/schema validation|Gate C promotion is forbidden/);
  completedMutation('stdin equivalent empty evidence acceptance',x=>{for(const row of x.rows){row.disposition='accepted';row.confidence='high';row.supporting_evidence_source_ids=[];row.opposing_evidence_source_ids=[];row.independent_support_family_ids=[];}},/schema validation|accepted is forbidden/);
  completedMutation('held high confidence',x=>{x.rows[0].disposition='held';x.rows[0].confidence='high';},/held confidence/);
  completedMutation('rejected low confidence',x=>{x.rows[0].disposition='rejected';x.rows[0].confidence='low';},/rejected confidence/);
  completedMutation('abstained high confidence',x=>{x.rows[0].disposition='abstained';x.rows[0].confidence='high';},/abstained disposition/);
  completedMutation('manual-only accepted forbidden',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c0-lovell');row.disposition='accepted';row.confidence='medium';},/schema validation|accepted is forbidden/);
  completedMutation('marker-only accepted forbidden',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c0-rpcq');row.disposition='accepted';row.confidence='medium';row.supporting_evidence_source_ids=['r0-rpcq-gazette'];row.independent_support_family_ids=['rpcq-register'];},/schema validation|accepted is forbidden/);
  completedMutation('predecessor-only accepted forbidden',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c10-spelling');row.disposition='accepted';row.confidence='medium';row.supporting_evidence_source_ids=['r10-city-archive-predecessor'];row.independent_support_family_ids=['city-vm94-z-series'];},/schema validation|accepted is forbidden/);
  completedMutation('multi-family unreviewed accepted forbidden',x=>{const row=x.rows.find((v:Json)=>v.claim_id==='c100-date');row.disposition='accepted';row.confidence='high';},/schema validation|accepted is forbidden/);
  mutate('premature adjudication',r=>{const x=read(path.join(r,'independent-adjudication-template-v1.json'));x.rows=[{}];write(path.join(r,'independent-adjudication-template-v1.json'),x);},/schema validation|premature/);
  mutate('unsupported promotion',r=>{const x=read(path.join(r,'primary-reviews-v1.json'));x.rows[0].promotion_eligible=true;write(path.join(r,'primary-reviews-v1.json'),x);},/schema validation|unsupported promotion/);
  mutate('metric drift',r=>{const x=read(path.join(r,'status-report-v1.json'));x.counts.held=3;write(path.join(r,'status-report-v1.json'),x);},/schema validation|status counts do not derive|seal mismatch/);
  mutate('report literal drift',r=>{const x=read(path.join(r,'status-report-v1.json'));x.final_authority=true;write(path.join(r,'status-report-v1.json'),x);},/unsupported final authority|schema validation/);
  mutate('post-seal mutation',r=>{const x=read(path.join(r,'claim-packets-v1.json'));x.claims[0].claim_text+=' altered';write(path.join(r,'claim-packets-v1.json'),x);},/complete canonical Gate B projection|seal mismatch/);
  mutate('gated output',r=>write(path.join(r,'accepted-claims-v1.json'),{}),/gated final output|additions/);
  mutate('descriptor omission',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.manifest.pop();write(path.join(r,'descriptor-v1.json'),x);},/schema validation|descriptor member paths/);
  mutate('descriptor duplicate',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.manifest[1]=structuredClone(x.manifest[0]);write(path.join(r,'descriptor-v1.json'),x);},/descriptor member paths/);
  mutate('descriptor tree drift',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.tree_sha256='a'.repeat(64);write(path.join(r,'descriptor-v1.json'),x);},/tree_sha256 drift/);
  mutate('descriptor scope drift',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.scope='changed';write(path.join(r,'descriptor-v1.json'),x);},/schema validation|complete authored descriptor/);
  mutate('descriptor created-at drift',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.created_at='2026-07-14T00:00:00.000Z';write(path.join(r,'descriptor-v1.json'),x);},/complete authored descriptor/);
  mutate('descriptor predecessor drift',r=>{const x=read(path.join(r,'descriptor-v1.json'));x.predecessor_artifact_id='other';write(path.join(r,'descriptor-v1.json'),x);},/schema validation|complete authored descriptor/);
  mutateResealed('coordinated descriptor member drift',r=>{const x=read(path.join(r,'status-report-v1.json'));x.plain_english='Coordinated replacement narrative.';write(path.join(r,'status-report-v1.json'),x);},/complete authored descriptor/);
  registryMutation('registry digest drift',x=>{x.content_digest.value='a'.repeat(64);},/digest drift/);
  registryMutation('registry count drift',x=>{x.counts.byte_count++;},/counts drift/);
  registryMutation('registry path drift',x=>{x.storage.locator='docs/dataset-factory/fixtures/other';},/path drift/);
  registryMutation('registry dependency drift',x=>{x.dependency_ids=[];},/dependency drift/);
  registryMutation('registry schema drift',x=>{x.schema_version='changed';},/complete canonical row/);
  registryMutation('registry source description drift',x=>{x.source_lineage.description='changed';},/complete canonical row/);
  registryMutation('registry source URL drift',x=>{x.source_lineage.source_urls=['https://example.com'];},/complete canonical row/);
  registryMutation('registry storage class drift',x=>{x.storage.storage_class='external';},/complete canonical row/);
  registryMutation('registry generation method drift',x=>{x.generation.method='deterministic_script';},/complete canonical row/);
  registryMutation('registry generation command drift',x=>{x.generation.command='changed';},/complete canonical row/);
  registryMutation('registry code ref drift',x=>{x.generation.code_ref='changed';},/complete canonical row/);
  registryMutation('registry human inputs drift',x=>{x.generation.human_input_ids=['synthetic'];},/complete canonical row/);
  registryMutation('registry required-by drift',x=>{x.required_by=[];},/complete canonical row/);
  registryMutation('registry rights license drift',x=>{x.rights_boundary.license_id='changed';},/complete canonical row/);
  registryMutation('registry attribution drift',x=>{x.rights_boundary.attribution='changed';},/complete canonical row/);
  registryMutation('registry commercial flag drift',x=>{x.rights_boundary.commercial_use_allowed=true;},/complete canonical row/);
  registryMutation('registry rights notes drift',x=>{x.rights_boundary.notes='changed';},/complete canonical row/);
  registryMutation('registry created-at drift',x=>{x.created_at='2026-07-14T00:00:00.000Z';},/complete canonical row/);
  registryMutation('registry time-basis drift',x=>{x.creation_time_basis='filesystem_mtime';},/complete canonical row/);
  mutate('approved reviewer byte SHA substitution',r=>fs.appendFileSync(path.join(r,AUTHORITY_FILE),' '),/byte\/SHA substitution/);
  authorityValueMutation('approved reviewer identity substitution',x=>{x.adjudicator.identity='019f5cea-fa84-7da0-be11-29d272f96522';},true,/identity substitution/);
  authorityValueMutation('approved reviewer session substitution',x=>{x.adjudicator.review_session_id='019f5cea-fa84-7da0-be11-29d272f96522';},true,/review session substitution/);
  mutate('approved disposition substitution',r=>{const x=read(path.join(r,AUTHORITY_FILE));x.rows[0].disposition='held';x.rows[0].confidence='medium';write(path.join(r,AUTHORITY_FILE),x);},/byte\/SHA substitution/);
  mutate('approved source substitution',r=>{const x=read(path.join(r,AUTHORITY_FILE));x.rows[0].supporting_evidence_source_ids[0]='r105-lovell-1944';write(path.join(r,AUTHORITY_FILE),x);},/byte\/SHA substitution/);
  mutate('approved family substitution',r=>{const x=read(path.join(r,AUTHORITY_FILE));x.rows[0].independent_support_family_ids[0]='fabricated-family';write(path.join(r,AUTHORITY_FILE),x);},/byte\/SHA substitution/);
  mutate('missing final authority member',r=>fs.rmSync(path.join(r,AUTHORITY_FILE)),/ENOENT|no such file/);
  mutate('not-started template posing as final authority',r=>fs.copyFileSync(path.join(r,'independent-adjudication-template-v1.json'),path.join(r,AUTHORITY_FILE)),/completed-adjudication schema validation/);
  mutate('status authority drift',r=>{const x=read(path.join(r,'status-report-v1.json'));x.independent_adjudication_authority=false;write(path.join(r,'status-report-v1.json'),x);},/status-report schema validation|status authority/);
  mutate('final artifact member omission',r=>fs.rmSync(path.join(r,'status-report-v1.json')),/ENOENT|no such file/);
  mutate('final artifact member addition',r=>write(path.join(r,'untracked-final.json'),{}),/fixture file paths/);
  return {self_test:'passed',cases:87,adversarial_rejections:87,accepted_non_promoting_cases:0,taxonomy:{predecessor_pin_and_commit:4,canonical_packet_projection:10,primary_review_and_report:9,completed_adjudication:23,descriptor_and_registry:26,schema_and_output_boundary:4,approved_authority_binding:11},real_adjudicator_fixture:true,approved_authority_sha256:APPROVED_AUTHORITY_SHA256};
}
function integration():Json{const a=fs.mkdtempSync(path.join(os.tmpdir(),'gca-a-')),b=fs.mkdtempSync(path.join(os.tmpdir(),'gca-b-'));try{build(a,AUTHORITY_PATH);build(b,AUTHORITY_PATH);const fa=fs.readdirSync(a).sort(),tracked=fs.readdirSync(FIXTURE).sort();assert(JSON.stringify(fa)===JSON.stringify(fs.readdirSync(b).sort()),'rebuild file set differs');assert(JSON.stringify(fa)===JSON.stringify(tracked),'deterministic replay file set differs from tracked final artifact');for(const f of fa){assert(bytes(path.join(a,f)).equals(bytes(path.join(b,f))),`rebuild differs: ${f}`);assert(bytes(path.join(a,f)).equals(bytes(path.join(FIXTURE,f))),`deterministic replay differs from tracked member: ${f}`);}return {integration_test:'passed',rebuild:'byte_identical',tracked_replay:'byte_identical',files:fa.length,authority_sha256:sha(bytes(path.join(a,AUTHORITY_FILE)))};}finally{fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});}}

function validateIndependent(file:string):Json{
  assert(file.length>0,'validate-adjudication requires a completed adjudication path');
  const resolved=path.resolve(file),raw=bytes(resolved),value=JSON.parse(raw.toString('utf8'));
  semantic(FIXTURE);
  const counts=validateIndependentValue(value,raw,FIXTURE,true);
  return {status:'approved_independent_adjudication_valid_non_promoting',rows:7,authority_sha256:sha(raw),adjudicator_identity:value.adjudicator.identity,review_session_id:value.adjudicator.review_session_id,...counts,authority_note:'This validator binds the approved operational reviewer/session identity and exact reviewer-authored file SHA. Gate C disposition authority is complete; promotion authority remains false. Any replacement requires an explicit new version and review.'};
}

function publish(file:string):Json{assert(file.length>0,'publish requires the approved external completed adjudication path');const resolved=path.resolve(file),raw=bytes(resolved),candidate=fs.mkdtempSync(path.join(os.tmpdir(),'gca-publish-'));try{build(candidate,resolved);validateIndependentValue(JSON.parse(raw.toString('utf8')),raw,candidate,true);build(FIXTURE,resolved);assert(bytes(path.join(FIXTURE,AUTHORITY_FILE)).equals(raw),'published authority bytes differ from external authority');resealRegistry();semantic(FIXTURE);return {status:'published',authority_member:AUTHORITY_FILE,authority_sha256:sha(raw),authority_bytes:raw.length,files:FIXTURE_PATHS.length,registry_resealed:true,production_mutation:false};}finally{fs.rmSync(candidate,{recursive:true,force:true});}}

const command=process.argv[2]??'verify';
if(command==='build')console.log(JSON.stringify(build()));else if(command==='verify')console.log(JSON.stringify(verify()));else if(command==='self-test')console.log(JSON.stringify(selfTest()));else if(command==='integration-test')console.log(JSON.stringify(integration()));else if(command==='validate-adjudication')console.log(JSON.stringify(validateIndependent(process.argv[3]??'')));else if(command==='publish')console.log(JSON.stringify(publish(process.argv[3]??'')));else throw new Error(`unknown command: ${command}`);
