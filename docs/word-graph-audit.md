# Word Graph generation audit

The checkbox in Settings > Graph controls recording for each generation attempt. Its value
is captured when the attempt begins, including a retry. The default is off.
When off, graph generation and IndexedDB recovery continue normally; no new
generation report or candidate history is saved. An earlier session report
remains until the user selects Clear report or the session ends.

When recording is on, the last report is saved to browser session storage.
Its `entries` contain one record per local proxy request attempt, including
operation, model, provider request ID when available, actual provider usage,
and an estimated USD cost when both usage and pricing are known. Response
summaries omit embedding vectors and repeated candidate lists. The
`candidate_decisions` array records every proposed candidate by association
request ID and response index. It includes exact calculated cosine distance,
the configured threshold, disposition, first decisive rejection reason, and
the admitted edge ID for accepted candidates. A null distance means no finite
distance was evaluated. `expansion_decisions` explains why a scheduled node
was not requested, or records that its association request failed.

Decision order matches generation: invalid candidate, duplicate relationship
identity within the response, outgoing source budget, finite cosine distance
and remoteness, node budget, then depth. Existing-node relationships may be
accepted without using a new node slot. An incoming relationship does not use
the target's outgoing budget. A duplicate candidate is not charged a slot.
Candidates returned but left unscored by an embedding failure or cancellation
are marked unresolved; no distance is invented for them. A failed association
request has no proposed candidates to record.

If an association request fails after useful relationships have been admitted,
successful branches continue and the validated graph is marked `partial`.
The window warns that it is incomplete, and the marker is kept in board-local
graph recovery data so the warning survives reload. A failed embedding request
stops further expansion but keeps an already admitted graph. If no relationship
was admitted, generation still reports an error rather than a root-only result.
Cancellation and structural validation errors still fail generation. A partial
audit records the failed request, successful candidate decisions, and
`run.status: "partial"`; the incomplete graph is not described as completed.
Proxy errors distinguish upstream HTTP status, connection failure, response
reading, provider JSON, and association-output parsing without retaining keys
or full response content.

The metrics count candidates, nodes, edges, request attempts, and reported
tokens separately. Request attempts that fail or lack usage keep unknown cost;
the total estimate is marked incomplete whenever any attempted request cannot
be priced. Received usage is retained in partial failed or cancelled reports.
These figures estimate token charges, not the final provider invoice.
The app does not automatically retry an API request. A user initiated Try again
starts a new generation with its own run ID and replaces the last report only
when recording is enabled for that attempt.

Standard API prices reviewed on 2026-10-22. The older model remains in the
pricing table for reports saved before the switch:

| Model | Input per 1M | Cached input per 1M | Output per 1M | Source |
| --- | ---: | ---: | ---: | --- |
| `gpt-6-luna` (current association model) | $0.10 | $0.01 | $0.50 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| `gpt-4o-mini` (including the `2024-07-18` snapshot) | $0.15 | $0.075 | $0.60 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| `text-embedding-3-small` | $0.02 | — | — | [OpenAI model page](https://developers.openai.com/api/docs/models/text-embedding-3-small) |

The proxy forwards OpenAI's reported model and usage. Responses API usage has
`input_tokens`, `output_tokens`, and `total_tokens`; embeddings usage has
`prompt_tokens` and `total_tokens`. Missing usage is never estimated from
text length. Unknown models are not priced using another model's rate.
