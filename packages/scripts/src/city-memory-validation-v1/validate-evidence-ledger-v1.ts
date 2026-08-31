import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const DIR = path.join(ROOT, 'docs/city-memory-validation-v1');
const SCHEMA = path.join(DIR, 'evidence-ledger.schema.v1.json');
const TEMPLATE = path.join(DIR, 'evidence-ledger.template.json');
const PROPOSAL = path.join(DIR, 'proposal.v1.json');
const EXPECTED_PROPOSAL_SHA256 = '048e71dff45a9d01e3f9a3f173c9a1cdc61f9957567b67980dd7ac803301f93a';
type Json = Record<string, any>;
type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv2020 = Ajv2020Import as unknown as new (options: Record<string, unknown>) => { compile(schema: object): Validator; errorsText(errors?: unknown): string };
const addFormats = addFormatsImport as unknown as (ajv: object) => void;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaValidator = ajv.compile(readJson(SCHEMA));

function readJson(file: string): Json { return JSON.parse(fs.readFileSync(file, 'utf8')) as Json; }
function resolveInput(requested: string): string {
  const cwdPath = path.resolve(requested);
  return fs.existsSync(cwdPath) ? cwdPath : path.resolve(ROOT, requested);
}
function fail(message: string): never { throw new Error(message); }
function canonicalJson(value: unknown): string { return JSON.stringify(value); }
function proposalDigest(proposal: Json): string { return crypto.createHash('sha256').update(canonicalJson(proposal)).digest('hex'); }
function proposalProjection(proposal: Json): Json {
  return { proposal_id: proposal.proposal_id, scope: proposal.scope, price_cad: proposal.price_cad, timeline_weeks: proposal.timeline_weeks, payment_schedule: proposal.payment_schedule, exclusions: proposal.exclusions };
}

export type LedgerResult = {
  status: 'template_only' | 'in_progress' | 'complete';
  kit_ready: true;
  external_evidence_status: 'none_recorded' | 'conversations_in_progress' | 'issue_evidence_complete';
  qualified_conversations: number;
  completed_conversations: number;
  proposal_tested: boolean;
  buyer_intent_slots: string[];
  payment_or_procurement_slots: string[];
  issue_completion_gate: boolean;
  commercial_signal_gate: boolean;
};

function validateEvidence(slot: Json, evidence: Json, proposal: Json, ids: Set<string>): void {
  assert.equal(ids.has(evidence.evidence_id), false, `duplicate evidence ID ${evidence.evidence_id}`);
  ids.add(evidence.evidence_id);
  assert.equal(evidence.evidence_id.startsWith(`${slot.slot_id}-`), true, `${slot.slot_id} evidence ID must have its slot prefix`);
  const linked = evidence.proposal_link;
  const linkIsExact = linked && canonicalJson(linked) === canonicalJson({ proposal_id: proposal.proposal_id, canonical_proposal_sha256: EXPECTED_PROPOSAL_SHA256 });
  const reject = (message: string) => fail(`${slot.slot_id}/${evidence.evidence_id}: ${message}`);
  if (evidence.class === 'opinion') {
    if (evidence.kind !== 'opinion' && evidence.kind !== 'decline_reason') reject('opinion has invalid evidence kind');
    if (evidence.source !== 'conversation_notes') reject('opinion must come from conversation notes');
    if (evidence.kind === 'opinion') {
      if (!['positive_reaction', 'negative_reaction', 'unclear_reaction'].includes(evidence.observation_code)) reject('opinion must use an opinion observation code');
      if (evidence.action !== 'none') reject('opinion cannot claim an action');
    }
    if (evidence.kind === 'decline_reason') {
      if (evidence.observation_code !== 'declined_proposal') reject('decline reason must use declined_proposal observation code');
      if (evidence.action !== 'declined') reject('decline reason must record declined action');
    }
    if (evidence.proposal_link !== null) reject('opinion cannot be buyer evidence through a proposal link');
  } else if (evidence.class === 'behavioral_signal') {
    if (!['workflow_observation', 'scheduled_action'].includes(evidence.kind)) reject('behavioral signal has invalid evidence kind');
    if (!['conversation_notes', 'follow_up_message'].includes(evidence.source)) reject('behavioral signal has invalid source');
    const behavioralObservationToAction: Record<string, string> = {
      shared_current_workflow: 'described_workflow',
      requested_tailored_sample: 'requested_tailored_sample',
      dated_internal_review: 'scheduled_review',
      introduced_decision_maker: 'introduced_decision_maker',
    };
    if (!Object.prototype.hasOwnProperty.call(behavioralObservationToAction, evidence.observation_code)) reject('behavioral signal has invalid observation code');
    if (evidence.action !== behavioralObservationToAction[evidence.observation_code]) reject('behavioral signal action does not match observation code');
    if (evidence.proposal_link !== null && !linkIsExact) reject('behavioral proposal link is not the canonical proposal');
  } else if (evidence.class === 'buyer_intent') {
    if (!['requested_scope', 'scheduled_action', 'written_commitment'].includes(evidence.kind)) reject('buyer intent has invalid evidence kind');
    if (evidence.source !== 'follow_up_message') reject('buyer intent must come from a follow-up message');
    const buyerIntentObservationToAction: Record<string, string> = {
      requested_fixed_scope: 'requested_fixed_scope',
      dated_internal_review: 'scheduled_review',
      introduced_decision_maker: 'introduced_decision_maker',
      written_yes: 'requested_fixed_scope',
    };
    if (evidence.action === 'none') reject('buyer intent must record a specific next action');
    if (!Object.prototype.hasOwnProperty.call(buyerIntentObservationToAction, evidence.observation_code)) reject('buyer intent has invalid observation code');
    if (evidence.action !== buyerIntentObservationToAction[evidence.observation_code]) reject('buyer intent action does not match observation code');
    if (!linkIsExact) reject('buyer intent must link the canonical proposal');
  } else if (evidence.class === 'payment_procurement') {
    if (!['procurement_artifact', 'payment_artifact'].includes(evidence.kind)) reject('payment/procurement has invalid evidence kind');
    if (!['private_procurement_artifact', 'private_payment_artifact'].includes(evidence.source)) reject('payment/procurement must reference a private artifact');
    const paymentObservationToAction: Record<string, string> = {
      procurement_started: 'submitted_procurement',
      signed_sow: 'signed_sow',
      paid_deposit: 'paid_deposit',
    };
    if (!Object.prototype.hasOwnProperty.call(paymentObservationToAction, evidence.observation_code)) reject('payment/procurement has invalid observation code');
    if (evidence.action !== paymentObservationToAction[evidence.observation_code]) reject('payment/procurement action does not match observation code');
    if (evidence.observation_code === 'paid_deposit' && evidence.kind !== 'payment_artifact') reject('paid_deposit requires a payment artifact');
    if (evidence.observation_code !== 'paid_deposit' && evidence.kind !== 'procurement_artifact') reject('procurement evidence requires a procurement artifact');
    if (!linkIsExact) reject('payment/procurement must link the canonical proposal');
  }
}

export function validateLedger(value: Json, requireAcceptance = false): LedgerResult {
  if (!schemaValidator(value)) fail(`evidence ledger schema validation failed: ${ajv.errorsText(schemaValidator.errors)}`);
  const proposal = readJson(PROPOSAL);
  const digest = proposalDigest(proposal);
  assert.equal(digest, EXPECTED_PROPOSAL_SHA256, `canonical proposal artifact digest changed: ${digest}`);
  const proposalTest = value.proposal_test as Json;
  assert.deepEqual(proposalProjection(proposalTest), proposalProjection(proposal), 'ledger proposal projection differs from canonical proposal artifact');
  assert.equal(proposalTest.canonical_proposal_sha256, digest, 'ledger proposal digest does not match canonical proposal artifact');

  const slots = value.slots as Json[];
  const expected = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'];
  assert.deepEqual(slots.map((slot) => slot.slot_id), expected, 'ledger slots must be exactly slot-1 through slot-5 in order');
  const completed = slots.filter((slot) => slot.status === 'completed');
  const ids = new Set<string>();
  const qualified = completed.filter((slot) => slot.qualification?.qualified === true && slot.qualification.active_need === true && slot.qualification.decision_access !== 'unknown');
  const completedRefs = completed.map((slot) => slot.stakeholder_ref);
  assert.equal(new Set(completedRefs).size, completedRefs.length, 'completed stakeholder references must be unique');
  for (const slot of completed) {
    const q = slot.qualification;
    assert.equal(q.qualified, true, `${slot.slot_id} is completed but not qualified`);
    assert.equal(q.active_need, true, `${slot.slot_id} has no active need`);
    assert.notEqual(q.decision_access, 'unknown', `${slot.slot_id} has unknown decision access`);
    assert.equal(slot.consent.consent_confirmed, true, `${slot.slot_id} requires confirmed consent`);
    if (slot.consent.recording !== 'not_recorded') assert.ok(slot.consent.private_reference, `${slot.slot_id} recording requires a private reference token`);
    assert.notEqual(slot.problem_urgency, 'none', `${slot.slot_id} must record non-none problem urgency`);
    assert.notEqual(slot.problem_urgency, 'unknown', `${slot.slot_id} must record problem urgency`);
    assert.notEqual(slot.budget_authority, 'unknown', `${slot.slot_id} must record budget authority`);
    assert.notEqual(slot.budget_authority, 'none', `${slot.slot_id} must record budget authority`);
    assert.notEqual(slot.procurement_path, 'unknown', `${slot.slot_id} must record procurement path`);
    assert.notEqual(slot.procurement_path, 'none', `${slot.slot_id} must record procurement path`);
    assert.notEqual(slot.next_step_code, 'none', `${slot.slot_id} must record a next step`);
    for (const evidence of slot.evidence) validateEvidence(slot, evidence, proposal, ids);
    const evidenceClasses = new Set(slot.evidence.map((evidence: Json) => evidence.class));
    if (slot.proposal_response === 'accepted') assert.equal(evidenceClasses.has('buyer_intent') || evidenceClasses.has('payment_procurement'), true, `${slot.slot_id} accepted response requires buyer-intent or payment/procurement evidence`);
    if (slot.proposal_response === 'declined') assert.equal(slot.evidence.some((evidence: Json) => evidence.class === 'opinion' && evidence.kind === 'decline_reason' && evidence.observation_code === 'declined_proposal'), true, `${slot.slot_id} declined response requires a decline-reason evidence item`);
    if (slot.proposal_response === 'accepted') {
      assert.notEqual(slot.budget_authority, 'unknown', `${slot.slot_id} accepted without budget authority`);
      assert.notEqual(slot.budget_authority, 'none', `${slot.slot_id} accepted without budget authority`);
      assert.notEqual(slot.procurement_path, 'unknown', `${slot.slot_id} accepted without procurement path`);
      assert.notEqual(slot.procurement_path, 'none', `${slot.slot_id} accepted without procurement path`);
    }
  }

  const proposalTested = proposalTest.status === 'tested';
  if (proposalTested) {
    assert.ok(Array.isArray(proposalTest.tested_by_slots) && proposalTest.tested_by_slots.length > 0, 'tested proposal needs tested_by_slots');
    for (const slotId of proposalTest.tested_by_slots) {
      const slot = slots.find((candidate) => candidate.slot_id === slotId);
      assert.equal(slot?.status, 'completed', `${slotId} is not a completed conversation used for the proposal test`);
      assert.equal(slot?.qualification?.qualified, true, `${slotId} is not qualified for the proposal test`);
      assert.notEqual(slot?.proposal_response, 'not_tested', `${slotId} has no real proposal response`);
    }
    assert.notEqual(proposalTest.acceptance_signal, 'not_tested', 'tested proposal must have an observed acceptance signal');
  } else {
    assert.equal(proposalTest.acceptance_signal, 'not_tested', 'untested proposal cannot have an acceptance signal');
  }

  if (proposalTest.acceptance_signal !== 'not_tested') {
    const slot = slots.find((candidate) => candidate.slot_id === proposalTest.acceptance_signal_slot);
    assert.equal(slot?.status, 'completed', 'acceptance signal must point to a completed slot');
    assert.notEqual(slot?.proposal_response, 'not_tested', 'acceptance signal slot must have a real proposal response');
    assert.ok(proposalTest.tested_by_slots?.includes(proposalTest.acceptance_signal_slot), 'acceptance signal slot must be among the proposal-tested slots');
    const responseBySignal: Record<string, string[]> = { interest_only: ['interested'], declined: ['declined'], written_yes: ['accepted'], signed_sow: ['accepted'], paid_deposit: ['accepted'], procurement_started: ['accepted'] };
    assert.ok(responseBySignal[proposalTest.acceptance_signal].includes(slot?.proposal_response), 'acceptance signal is incompatible with the slot proposal response');
    const evidence = slot?.evidence.find((candidate: Json) => candidate.evidence_id === proposalTest.acceptance_signal_evidence_id);
    assert.ok(evidence, 'acceptance signal must point to an existing evidence item');
    const signalClass: Record<string, string[]> = { interest_only: ['opinion'], written_yes: ['buyer_intent'], signed_sow: ['payment_procurement'], paid_deposit: ['payment_procurement'], procurement_started: ['payment_procurement'], declined: ['opinion'] };
    if (!signalClass[proposalTest.acceptance_signal].includes(evidence.class)) fail('acceptance signal class does not match evidence class');
    if (proposalTest.acceptance_signal === 'interest_only') assert.equal(evidence.observation_code, 'positive_reaction', 'interest_only must be a positive opinion, not a buyer-intent claim');
    if (proposalTest.acceptance_signal === 'declined') assert.equal(evidence.kind, 'decline_reason', 'declined acceptance signal must be a decline reason');
    if (['interest_only', 'declined'].includes(proposalTest.acceptance_signal)) assert.equal(evidence.proposal_link, null, 'opinion-only interest/decline must not pretend to be proposal-linked buyer evidence');
    else assert.equal(evidence.proposal_link?.canonical_proposal_sha256, EXPECTED_PROPOSAL_SHA256, 'positive acceptance evidence must link the canonical proposal');
    if (proposalTest.acceptance_signal === 'written_yes' && evidence.observation_code !== 'written_yes') fail('written_yes acceptance signal does not match evidence observation');
    if (proposalTest.acceptance_signal === 'signed_sow' && evidence.observation_code !== 'signed_sow') fail('signed_sow acceptance signal does not match evidence observation');
    if (proposalTest.acceptance_signal === 'procurement_started' && evidence.observation_code !== 'procurement_started') fail('procurement_started acceptance signal does not match evidence observation');
    if (proposalTest.acceptance_signal === 'paid_deposit' && evidence.observation_code !== 'paid_deposit') fail('paid_deposit acceptance signal does not match evidence observation');
    if (proposalTest.acceptance_signal === 'declined' && evidence.observation_code !== 'declined_proposal') fail('declined acceptance signal does not match evidence observation');
  }

  const buyerIntentSlots = qualified.filter((slot) => slot.evidence.some((evidence: Json) => evidence.class === 'buyer_intent' || evidence.class === 'payment_procurement')).map((slot) => slot.slot_id);
  const paymentSlots = qualified.filter((slot) => slot.evidence.some((evidence: Json) => evidence.class === 'payment_procurement')).map((slot) => slot.slot_id);
  const minimumGate = qualified.length >= 5 && proposalTested;
  const positiveAcceptanceSignal = ['written_yes', 'signed_sow', 'paid_deposit', 'procurement_started'].includes(proposalTest.acceptance_signal);
  const commercialSignalGate = minimumGate && buyerIntentSlots.length > 0 && positiveAcceptanceSignal;
  const decision = value.decision as Json;
  const study = value.study as Json;
  if (!minimumGate) {
    if (decision.status === 'stop') {
      assert.ok(['structural_blocker', 'rights_or_quality_blocker', 'recruitment_blocker'].includes(decision.rationale_code), 'early stop requires a structural, rights/quality, or recruitment blocker');
      assert.equal(study.status, 'stopped', 'early stop decision must mark study stopped');
      assert.equal(study.honest_status, 'stopped_before_five', 'early stop must disclose fewer than five qualified conversations');
    } else {
      assert.equal(decision.status, 'not_ready', 'decision must remain not_ready until five qualified conversations and proposal test exist');
      assert.equal(study.status, completed.length === 0 ? 'not_started' : 'in_progress', 'study status must reflect whether conversations have started');
      assert.equal(study.honest_status, completed.length === 0 ? 'no_conversations_performed' : 'conversations_in_progress', 'study honest status does not match conversation count');
    }
  } else if (!commercialSignalGate) {
    assert.ok(decision.status === 'revise' || decision.status === 'stop', 'after minimum evidence without buyer intent, decision must be revise or stop');
    assert.ok(decision.rationale_code === 'price_scope_or_segment_revision' || decision.rationale_code === 'structural_blocker' || decision.rationale_code === 'rights_or_quality_blocker', 'revise/stop rationale is incoherent');
  } else {
    assert.notEqual(decision.status, 'not_ready', 'decision cannot remain not_ready after the external evidence gate');
  }
  if (decision.status === 'continue') {
    assert.equal(commercialSignalGate, true, 'continue requires the positive commercial-signal gate');
    assert.equal(decision.rationale_code, 'qualified_need_and_intent', 'continue requires the qualified_need_and_intent rationale');
  }
  if (decision.status === 'not_ready') assert.equal(decision.rationale_code, 'evidence_pending', 'not_ready requires evidence_pending rationale');
  if (decision.status === 'revise') assert.equal(decision.rationale_code, 'price_scope_or_segment_revision', 'revise requires a price, scope, or segment rationale');
  if (decision.status === 'stop') assert.ok(['structural_blocker', 'rights_or_quality_blocker', 'recruitment_blocker'].includes(decision.rationale_code), 'stop requires a blocker rationale');
  if (completed.length >= 5 && decision.status !== 'stop') assert.equal(study.honest_status, 'five_qualified_conversations_recorded', 'five completed slots require honest five-conversation status');
  if (decision.status === 'stop') assert.equal(study.honest_status, qualified.length >= 5 ? 'five_qualified_conversations_recorded' : 'stopped_before_five', 'stop decision honest status does not match qualified conversation count');
  assert.equal(study.status === 'complete', decision.status === 'continue' || decision.status === 'revise', 'study/decision state mismatch');
  if (decision.status === 'stop') assert.equal(study.status, 'stopped', 'stop decision must mark study stopped');
  const issueCompletionGate = minimumGate && ['continue', 'revise', 'stop'].includes(decision.status);
  const status: LedgerResult['status'] = issueCompletionGate ? 'complete' : completed.length === 0 ? 'template_only' : 'in_progress';
  if (requireAcceptance && !issueCompletionGate) fail(`issue acceptance criteria not met: ${qualified.length}/5 qualified conversations, proposal_tested=${proposalTested}, decision=${decision.status}`);
  return { status, kit_ready: true, external_evidence_status: issueCompletionGate ? 'issue_evidence_complete' : completed.length === 0 ? 'none_recorded' : 'conversations_in_progress', qualified_conversations: qualified.length, completed_conversations: completed.length, proposal_tested: proposalTested, buyer_intent_slots: buyerIntentSlots, payment_or_procurement_slots: paymentSlots, issue_completion_gate: issueCompletionGate, commercial_signal_gate: commercialSignalGate };
}

function selfTest(): void {
  const template = readJson(TEMPLATE);
  assert.equal(resolveInput('docs/city-memory-validation-v1/evidence-ledger.template.json'), TEMPLATE);
  const empty = validateLedger(template);
  assert.equal(empty.status, 'template_only'); assert.equal(empty.issue_completion_gate, false); assert.equal(empty.commercial_signal_gate, false);
  assert.throws(() => validateLedger(template, true), /issue acceptance criteria not met/);
  const malformed = structuredClone(template); malformed.slots.pop(); assert.throws(() => validateLedger(malformed), /schema validation failed/);
  const fakeCompleted = structuredClone(template); fakeCompleted.slots[0] = { slot_id: 'slot-1', status: 'completed' }; assert.throws(() => validateLedger(fakeCompleted), /schema validation failed/);
  const noActionBuyer = structuredClone(template); noActionBuyer.slots = completedSlots('buyer_intent', 'none'); noActionBuyer.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(noActionBuyer), /must record a specific next action/);
  const socialBuyer = structuredClone(template); socialBuyer.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); socialBuyer.slots[0].evidence[0].source = 'conversation_notes'; socialBuyer.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(socialBuyer), /buyer intent must come from/);
  const opinionMismatch = structuredClone(template); opinionMismatch.slots = completedSlots('opinion', 'none'); opinionMismatch.slots[0].evidence[0].observation_code = 'written_yes'; assert.throws(() => validateLedger(opinionMismatch), /opinion must use an opinion observation code/);
  const acceptedWithoutIntent = structuredClone(template); acceptedWithoutIntent.slots = completedSlots('behavioral_signal', 'described_workflow'); acceptedWithoutIntent.slots[0].proposal_response = 'accepted'; assert.throws(() => validateLedger(acceptedWithoutIntent), /accepted response requires buyer-intent/);
  const paymentMismatch = structuredClone(template); paymentMismatch.slots = completedSlots('payment_procurement', 'paid_deposit'); paymentMismatch.slots[0].evidence[0].observation_code = 'procurement_started'; assert.throws(() => validateLedger(paymentMismatch), /action does not match|procurement evidence requires/);
  const duplicate = structuredClone(template); duplicate.slots = completedSlots('behavioral_signal', 'described_workflow'); duplicate.slots[1].evidence[0].evidence_id = 'slot-1-e1'; assert.throws(() => validateLedger(duplicate), /duplicate evidence ID/);
  const noConsent = structuredClone(template); noConsent.slots = completedSlots('behavioral_signal', 'described_workflow'); noConsent.slots[0].consent.consent_confirmed = false; assert.throws(() => validateLedger(noConsent), /requires confirmed consent/);
  const recordingWithoutRef = structuredClone(template); recordingWithoutRef.slots = completedSlots('behavioral_signal', 'described_workflow'); recordingWithoutRef.slots[0].consent.recording = 'audio'; assert.throws(() => validateLedger(recordingWithoutRef), /recording requires a private reference/);
  const incompleteFields = structuredClone(template); incompleteFields.slots = completedSlots('behavioral_signal', 'described_workflow'); incompleteFields.slots[0].problem_urgency = 'unknown'; incompleteFields.slots[1].next_step_code = 'none'; assert.throws(() => validateLedger(incompleteFields), /must record problem urgency|must record a next step/);
  const noBudgetAuthority = structuredClone(template); noBudgetAuthority.slots = completedSlots('opinion', 'none'); noBudgetAuthority.slots[0].budget_authority = 'none'; assert.throws(() => validateLedger(noBudgetAuthority), /must record budget authority/);
  const noProcurementPath = structuredClone(template); noProcurementPath.slots = completedSlots('opinion', 'none'); noProcurementPath.slots[0].procurement_path = 'none'; assert.throws(() => validateLedger(noProcurementPath), /must record procurement path/);
  const incompatibleResponse = structuredClone(template); incompatibleResponse.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); incompatibleResponse.slots[0].proposal_response = 'interested'; incompatibleResponse.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(incompatibleResponse), /incompatible with the slot proposal response/);
  const untestedAcceptanceSlot = structuredClone(template); untestedAcceptanceSlot.slots = completedSlots('opinion', 'none'); untestedAcceptanceSlot.proposal_test = testedProposal('slot-1', 'interest_only', 'slot-1-e1'); untestedAcceptanceSlot.proposal_test.tested_by_slots = ['slot-2']; assert.throws(() => validateLedger(untestedAcceptanceSlot), /acceptance signal slot must be among/);
  const noBudgetPath = structuredClone(template); noBudgetPath.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); noBudgetPath.slots[0].proposal_response = 'accepted'; noBudgetPath.slots[0].budget_authority = 'unknown'; noBudgetPath.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(noBudgetPath), /must record budget authority|accepted without budget authority/);
  const noProposalResponse = structuredClone(template); noProposalResponse.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); noProposalResponse.slots[0].proposal_response = 'not_tested'; noProposalResponse.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(noProposalResponse), /no real proposal response/);
  const wrongAcceptanceEvidence = structuredClone(template); wrongAcceptanceEvidence.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); wrongAcceptanceEvidence.slots[0].evidence[0].observation_code = 'dated_internal_review'; wrongAcceptanceEvidence.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); assert.throws(() => validateLedger(wrongAcceptanceEvidence), /acceptance signal class|acceptance signal does not match|action does not match/);
  const drift = structuredClone(template); drift.proposal_test.scope = 'Drifted scope'; assert.throws(() => validateLedger(drift), /schema validation failed/);
  const digestDrift = structuredClone(template); digestDrift.proposal_test.canonical_proposal_sha256 = '0'.repeat(64); assert.throws(() => validateLedger(digestDrift), /schema validation failed/);
  const stateBypass = structuredClone(template); stateBypass.decision.status = 'continue'; assert.throws(() => validateLedger(stateBypass), /decision must remain not_ready/);
  const publicSensitive = structuredClone(template); publicSensitive.slots[0].name = 'A real person'; publicSensitive.slots[0].raw_budget = 9999; assert.throws(() => validateLedger(publicSensitive), /schema validation failed/);
  const earlyStop = structuredClone(template); earlyStop.study.status = 'stopped'; earlyStop.study.honest_status = 'stopped_before_five'; earlyStop.decision = { status: 'stop', owner: 'study-owner', rationale_code: 'recruitment_blocker' }; assert.equal(validateLedger(earlyStop).issue_completion_gate, false); assert.throws(() => validateLedger(earlyStop, true), /issue acceptance criteria not met/);
  const accepted = structuredClone(template); accepted.slots = completedSlots('buyer_intent', 'requested_fixed_scope'); accepted.proposal_test = testedProposal('slot-1', 'written_yes', 'slot-1-e1'); accepted.study.status = 'complete'; accepted.study.honest_status = 'five_qualified_conversations_recorded'; accepted.decision = { status: 'continue', owner: 'study-owner', rationale_code: 'qualified_need_and_intent' }; assert.equal(validateLedger(accepted, true).commercial_signal_gate, true);
  const interestOnly = structuredClone(template); interestOnly.slots = completedSlots('opinion', 'none'); interestOnly.proposal_test = testedProposal('slot-1', 'interest_only', 'slot-1-e1'); interestOnly.study.status = 'complete'; interestOnly.study.honest_status = 'five_qualified_conversations_recorded'; interestOnly.decision = { status: 'revise', owner: 'study-owner', rationale_code: 'price_scope_or_segment_revision' }; assert.equal(validateLedger(interestOnly, true).commercial_signal_gate, false);
  const negativeInterest = structuredClone(interestOnly); negativeInterest.slots[0].evidence[0].observation_code = 'negative_reaction'; assert.throws(() => validateLedger(negativeInterest), /interest_only must be a positive opinion/);
  const declined = structuredClone(template); declined.slots = completedSlots('opinion', 'none'); declined.slots[0].proposal_response = 'declined'; declined.slots[0].evidence[0] = { ...declined.slots[0].evidence[0], kind: 'decline_reason', action: 'declined', observation_code: 'declined_proposal' }; declined.proposal_test = testedProposal('slot-1', 'declined', 'slot-1-e1'); declined.study.status = 'stopped'; declined.study.honest_status = 'five_qualified_conversations_recorded'; declined.decision = { status: 'stop', owner: 'study-owner', rationale_code: 'structural_blocker' }; assert.equal(validateLedger(declined, true).commercial_signal_gate, false);
  console.log(JSON.stringify({ status: 'ok', adversarial_cases: 24 }));
}

function evidence(slotId: string, className: string, action: string): Json {
  const n = slotId.slice(-1);
  const base = { evidence_id: `${slotId}-e1`, class: className, kind: className === 'opinion' ? 'opinion' : className === 'behavioral_signal' ? 'workflow_observation' : className === 'buyer_intent' ? 'written_commitment' : 'payment_artifact', source: className === 'opinion' ? 'conversation_notes' : className === 'behavioral_signal' ? 'conversation_notes' : className === 'buyer_intent' ? 'follow_up_message' : 'private_payment_artifact', action, observation_code: className === 'opinion' ? 'positive_reaction' : className === 'behavioral_signal' ? 'shared_current_workflow' : className === 'buyer_intent' ? 'written_yes' : 'paid_deposit', private_reference: `private-evidence-${n}`, strength: 'strong', proposal_link: className === 'opinion' || className === 'behavioral_signal' ? null : { proposal_id: 'city-memory-diagnostic-001', canonical_proposal_sha256: EXPECTED_PROPOSAL_SHA256 } };
  return base;
}
function completedSlots(className: string, action: string): Json[] {
  return [1, 2, 3, 4, 5].map((n) => { const slotId = `slot-${n}`; return { slot_id: slotId, status: 'completed', stakeholder_ref: `stakeholder-${n}`, conversation_date: '2026-08-31', facilitator_ref: 'study-owner', qualification: { segment: 'boutique_hotel', role_category: 'owner', decision_access: 'owner', active_need: true, qualified: true }, consent: { recording: 'not_recorded', consent_confirmed: true, private_reference: null }, problem_urgency: 'high', problem_code: 'curation', workaround_code: 'manual_curation', budget_authority: 'owner', procurement_path: 'existing_budget', proposal_response: className === 'opinion' ? 'interested' : className === 'behavioral_signal' ? 'asked_to_follow_up' : 'accepted', objection_code: 'none', next_step_code: 'internal_review', private_notes_ref: `private-notes-${n}`, evidence: [evidence(slotId, className, action)] }; });
}
function testedProposal(slotId: string, signal: string, evidenceId: string): Json { return { ...readJson(TEMPLATE).proposal_test, status: 'tested', acceptance_signal: signal, acceptance_signal_slot: slotId, acceptance_signal_evidence_id: evidenceId, tested_by_slots: [slotId] }; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { input: { type: 'string', default: TEMPLATE }, 'require-acceptance': { type: 'boolean', default: false }, 'self-test': { type: 'boolean', default: false } } });
  if (values['self-test']) selfTest();
  else console.log(JSON.stringify(validateLedger(readJson(resolveInput(values.input!)), values['require-acceptance'])));
}
