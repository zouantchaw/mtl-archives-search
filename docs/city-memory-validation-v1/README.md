# City Memory Study 001 — buyer-validation operating kit

Issue #109 tests whether a qualified stakeholder will pay to address a real problem with the City Memory / Provenance specimen. This packet is the operating boundary for that test; it is not a claim that the test has happened.

The fixed $3,500 CAD proposal is the digest-bound Diagnostic 001 used by this
predecessor test. It is not the canonical Provenance service ladder or the
default City Memory Concept Study price. Do not edit `proposal.v1.json` in
place. If the active roadmap uses it, preserve the exact version and approve it
as reduced-scope discovery with a predefined credit/conversion path. Any new
route, scope, timeline, price, or payment schedule requires a new proposal
version and digest.

## Current status

**Ready to run; external evidence not started. No stakeholder conversations have been performed and no buyer evidence is recorded.** The checked-in [evidence-ledger.template.json](./evidence-ledger.template.json) is an honest empty template and cannot satisfy the issue acceptance criteria. Run the validator in acceptance mode only after real, consented conversations and a proposal test have occurred. The machine result deliberately separates `kit_ready: true` from `status: "template_only"` and `external_evidence_status: "none_recorded"`; readiness of this kit is not completion of the buyer test.

## What is being tested

The buyer is a Montreal boutique hotel, hospitality art programme, workplace/common-area programme, cultural institution, archive partner, interior-design practice, or art advisor with an active need for a defensible cultural-art or interpretation output. The relevant decision-maker can approve, recommend, or procure a commission, installation, or programme; a general archive enthusiast is not qualified.

The decision the specimen supports is: **“Should we commission a bounded City Memory diagnostic for this space or programme, and can we defend the resulting images, claims, attribution, and provenance to our guests, clients, board, or archive partner?”**

The merged #73 specimen is an upstream input, not duplicated here. Use the buyer-ready package under `docs/city-memory-study-001/` (brief/thesis, selected directions, provenance ledger, spatial applications, interactive study, deck, reel, and offer). Do not treat a #73 artifact, a social reaction, or an internal review as buyer validation.

## Five qualified slots

Recruit exactly five stakeholders across the segments above. A slot is qualified only when all are true:

1. They own or materially influence a decision about cultural artwork, interpretation, archive programming, or a comparable space/programme.
2. They describe a current problem or upcoming project, not merely a general appreciation of history or AI.
3. They can explain the budget/procurement path or identify who can.
4. They can react to the fixed proposal and agree to a concrete next step (including a clear decline).

Use role category, organization type, and `stakeholder-1`…`stakeholder-5` only. Names, contact details, raw recordings, and sensitive commercial material stay in an approved private system and never in this file or the GitHub issue.

## Run order

1. Confirm qualification and consent before showing the specimen.
2. Ask the problem/workaround questions in [interview-guide.md](./interview-guide.md) before explaining the solution.
3. Walk through the specimen in the fixed order in [walkthrough-and-proposal.md](./walkthrough-and-proposal.md), recording what the stakeholder does or commits to.
4. Test the exact offer once, without negotiating scope during the interview.
5. Send the neutral follow-up and log only redacted, contemporaneous summaries; see [follow-up-consent.md](./follow-up-consent.md).
6. Validate the ledger and apply the rubric and decision rule below.

## Evidence gate and decision rule

Use [evidence-rubric.md](./evidence-rubric.md) to label each observation. Opinions are useful for language and design; they are not demand. Behavioral signals show effort or a real workflow. Buyer intent requires a specific next step tied to the offer. Payment/procurement is the strongest signal.

Issue completion requires at least five completed, qualified slots; every slot must have non-unknown problem urgency, budget authority, procurement path, objection, proposal response, and a non-none next step; the fixed $3,500 CAD proposal must be tested at least once; and the owner must record an explicit `continue`, `revise`, or `stop` decision. A negative result can complete the issue honestly.

Continue only when the stronger commercial-signal gate also passes: at least one stakeholder gives buyer-intent evidence (`written_yes`, `signed_sow`, procurement started, or paid deposit). A paid deposit is the only payment signal; interest is not payment. The global signal must match the tested slot’s response (`accepted` for positive intent/payment, `interested` for interest-only, or `declined` for a decline).

Revise when five qualified conversations are complete but the intent gate fails, or when repeated objections point to a fixable scope, price, proof, or buyer segment issue. State the revision and rerun the proposal with a new version; do not relabel old interest as acceptance.

Stop when fewer than five qualified stakeholders can be found after the planned recruitment window, no active problem recurs, the proposal is repeatedly declined for a structural reason, or rights/quality constraints make the promised output indefensible. A terminal blocker may be recorded as `stop` before the gate; otherwise, until five conversations and one proposal test exist, the only valid decision is `not_ready`.

The owner records the coded decision rationale in the ledger. `not_ready` is required before five qualified conversations and a proposal test; `continue` is impossible without the full buyer-intent gate; `revise` requires a scope/price/segment or quality/rights reason; and `stop` requires a structural/recruitment/rights-quality blocker. `issue_completion_gate` reports whether #109's evidence-and-decision criteria are complete; `commercial_signal_gate` separately reports whether the evidence supports continuing. A private reference token only points to an external note/artifact; this validator cannot verify that private material exists or is authentic. External blockers remaining now: recruit five qualified stakeholders, obtain consent, show the landed #73 package, test the fixed proposal, and capture private follow-up/procurement evidence.

## Machine check

```sh
npm run city-memory:validation:verify-v1 -- --input docs/city-memory-validation-v1/evidence-ledger.template.json
npm run city-memory:validation:verify-v1 -- --input /private/path/ledger.json --require-acceptance
npm run city-memory:validation:self-test-v1
```

The first command should report `status: "template_only"`, `kit_ready: true`, `external_evidence_status: "none_recorded"`, and zero qualified conversations. The exact proposal is [proposal.v1.json](./proposal.v1.json); edit it only through a versioned proposal change and update its digest in the schema/template/tests. `--require-acceptance` verifies the issue's five-conversation/proposal/decision acceptance criteria; a completed `revise` or `stop` outcome passes while `commercial_signal_gate` remains false.
