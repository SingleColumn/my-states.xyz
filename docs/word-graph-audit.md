# Word Graph generation audit

The Settings checkbox controls recording for each generation attempt. Its value
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
was not requested, such as reaching maximum depth or the node budget.

Decision order matches generation: invalid candidate, duplicate relationship
identity within the response, outgoing source budget, finite cosine distance
and remoteness, node budget, then depth. Existing-node relationships may be
accepted without using a new node slot. An incoming relationship does not use
the target's outgoing budget. A duplicate candidate is not charged a slot.
Candidates left unfinished by a failed or cancelled attempt are marked
unresolved; no distance is invented for them.

The metrics count candidates, nodes, edges, request attempts, and reported
tokens separately. Request attempts that fail or lack usage keep unknown cost;
the total estimate is marked incomplete whenever any attempted request cannot
be priced. Received usage is retained in partial failed or cancelled reports.
These figures estimate token charges, not the final provider invoice.
The app does not automatically retry an API request. A user initiated Try again
starts a new generation with its own run ID and replaces the last report only
when recording is enabled for that attempt.

Standard API prices reviewed on 2026-10-21:

| Model | Input per 1M | Cached input per 1M | Output per 1M | Source |
| --- | ---: | ---: | ---: | --- |
| `gpt-4o-mini` (including the `2024-07-18` snapshot) | $0.15 | $0.075 | $0.60 | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| `text-embedding-3-small` | $0.02 | — | — | [OpenAI model page](https://developers.openai.com/api/docs/models/text-embedding-3-small) |

The proxy forwards OpenAI's reported model and usage. Responses API usage has
`input_tokens`, `output_tokens`, and `total_tokens`; embeddings usage has
`prompt_tokens` and `total_tokens`. Missing usage is never estimated from
text length. Unknown models are not priced using another model's rate.
