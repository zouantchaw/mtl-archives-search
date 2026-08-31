# Evidence rubric

Label the strongest evidence actually observed. Do not upgrade a weaker class because a stakeholder is senior or enthusiastic.

| Class | What counts | What it cannot prove |
| --- | --- | --- |
| `opinion` | `positive_reaction`, `negative_reaction`, or `unclear_reaction` from consented conversation notes | A current problem, budget, or willingness to buy |
| `behavioral_signal` | A coded workflow observation, requested sample, scheduled review, or decision-maker introduction with a private evidence reference | Approval or payment |
| `buyer_intent` | A fixed-proposal request, dated internal review, decision-maker introduction, or written yes in a follow-up message, linked to the canonical proposal | Money changing hands |
| `payment_procurement` | Signed SOW, procurement initiation, or paid deposit represented by a private procurement/payment artifact, linked to the canonical proposal | Historical truth of any archive claim; keep commercial evidence separate from provenance evidence |

The coded observation and action must agree: a workflow observation is not a written commitment, and procurement/payment observations are reserved for their matching private artifact. Strength is `weak` for a single vague statement, `moderate` for a specific action or repeated problem with a plausible next step, and `strong` for an observable commitment or payment/procurement artifact. One conversation may contain several classes; retain each separately and use the strongest only for the decision gate.

Every completed slot records categorical `problem_urgency`, `problem_code`, `workaround_code`, `budget_authority`, `procurement_path`, `proposal_response`, `objection_code`, and `next_step_code`, plus a `private_notes_ref`. Completed slots cannot use unknown urgency/authority/path or a none next step. Detailed summaries remain private and are never copied into this public ledger; a private token is only a pointer and is not independently verified by the validator. Social likes, page views, internal opinions, no-action summaries, and invented or backfilled notes are not buyer evidence.
