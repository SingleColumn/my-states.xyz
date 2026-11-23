# Board-sharing trial preparation and operation

The baseline and design notes below were written before implementation. The final section records the implemented trial and current verification status; it supersedes future-tense statements in the earlier notes.

Baseline inspection was performed on 2026-11-23 in `C:\local-dev\my-states-board-sharing`, branch `experiment/board-sharing`, starting at `2407a0cf3eac1c19156c8f556dd0eb39ca19f8d9`. The branch already had a Vercel Preview deployment; Production tracks `main`. Those baseline results were recorded before trial implementation.

## Baseline and archive checks

The repository documents npm and has `package-lock.json`. Commands run in this worktree:

| Command | Result |
| --- | --- |
| `npm ci` | Passed; installed 459 locked packages without changing the lockfile. npm reported 39 dependency advisories (1 low, 32 moderate, 6 high); no audit fix was run. |
| `npm test` | Began, then was manually interrupted after several minutes with no summary. This was not recorded as a test failure. |
| `npx vitest run --maxWorkers=1` | Passed: 69 files, 638 tests in 203 seconds. |
| `node --test scripts/*.test.mjs` | Passed: 8 tests. |
| `npx vitest run src/boardArchive.test.ts --maxWorkers=1` | Passed: 38 archive tests. |
| `npm run build` | Passed: TypeScript and Vite build. Vite warned that some output chunks exceed 500 kB. |
| `npx playwright test browser-tests/boards.spec.ts --project=chromium --grep "export writes a"` | Passed the existing browser export/import test. Playwright started the local dev server successfully. |
| `npx playwright test browser-tests/board-sharing-baseline.spec.ts --project=chromium` | Passed the focused two-context test below. |
| `npx playwright test browser-tests/board-sharing-baseline.spec.ts --project=chromium --repeat-each=2` | Passed twice after the test waited for camera zoom and its saved record to settle. |
| `npx tsc -p tsconfig.browser-tests.json --noEmit` | Passed after correcting a test-only file-size import. |

No application defect was found or changed. An intermediate repeat of the new browser test failed because its source camera snapshot was taken during wheel-zoom animation, before the export captured the settled camera. The test now waits for the on-screen and stored zoom to agree, then waits out the save debounce; two repeat runs passed. The new browser test is a regression check, not sharing implementation.

The exporter `exportBoardArchive`, ZIP extraction `extractArchive`, manifest validator `validateManifest`, and importer `importBoardArchive` are in `src/boardArchive.ts`. The file also defines manifest format 3 and reads format 2; format 1 is refused. `src/storage.ts` defines board size limits and `importBoardContent`, which gives imported boards, panels, notes, and images new local identities. Relevant tests are `src/boardArchive.test.ts`, `src/storage.safety.test.ts`, `browser-tests/boards.spec.ts`, and `browser-tests/board-sharing-baseline.spec.ts`.

### Reference board: tested successfully

At 1440 × 900, the focused Playwright test created a board named “Sharing reference” with a Markdown heading, bold text and list, one local PNG, a selected Music playlist reference, a board-pinned Terminal theme, distinct panel positions and sizes, changed stacking order, and a panned and zoomed camera. It exported through the existing **Export board** UI, inspected the ZIP manifest and image entry, then imported through the existing file input into a fresh browser context with no source-board storage or creator authentication. It compared note content, playlist configuration, theme, panel geometry/order, camera record, and exact stored image bytes; the imported image rendered. An edit to the recipient note left the source note unchanged, and the recipient edit survived reload. The browser test passed. This tests the current manual file flow; it says nothing yet about a share-link flow.

The reference archive was **1,335–1,339 bytes** with one tiny PNG across the passing runs. Approximate UI export times were **147–429 ms** and import/open times **313–406 ms** on this machine. These timings are a few local runs, not a performance estimate for larger boards or R2 transfers. The new test prints measurements on each run.

### Curated R2 image: untested end to end

The checkout has no configured `VITE_IMAGE_COLLECTIONS_BASE_URL`, and the public Preview bundle did not reveal a curated-feed URL. No real R2 collection image was therefore selected, exported, and imported across clean browser contexts. The public feed URL (the root containing `collections/index.json`) is needed to do that check; no credential is needed. The archive unit tests **did pass** simulated curated-download and import cases, including embedded image entries and local session assets after import. Code inspection shows curated image bytes are fetched during export and packaged under `images/` with attribution; the imported panel is converted to local `session-assets`. Those findings are **tested in unit tests / inspected in code**, not a successful real R2 browser round trip.

To finish this check: set the public feed root in a local `.env` for this worktree, start `npm run dev`, and at 1440 × 900 choose a curated collection in Images. Export the board and inspect the ZIP for `manifest.json` plus an `images/` entry whose byte count matches the manifest. In a fresh browser profile at the same origin and viewport, import the archive through the current file input. Confirm the image renders, its source is now local, and its attribution survives. Block the curated feed and reload; the image should still render from the imported board. Record archive bytes and timings, then remove the local test configuration. Do not use a credential or private R2 object URL for this public-feed check.

### Portability limits: inspected only

The archive carries board name, panel configuration and layout, camera, Markdown notes, active local image blobs, pinned theme information, and a selected Spotify track or playlist reference. A curated image is intended to become a local asset; a bundled sample collection retains its app-bundled reference. Spotify search results, account authorization, and playback session do not travel. A Spotify reference still needs Spotify's service and the recipient's own session for full playback. Remote links embedded in notes and any other externally hosted media still need their respective services. A browser folder handle is not in the archive. These limits are from `src/boardArchive.ts`, `src/storage.ts`, and README's archive section; they were not all exercised in the focused browser test.

## Agreed trial behavior

- Each Share click captures a fixed archive. Later creator edits do not change it.
- Possession of the share link permits receipt without an app account.
- The recipient gets an independent editable local board.
- Reopening a share on the same origin and browser profile opens its existing local copy, preserving recipient edits. If that copy is gone, a fresh import is allowed while the remote share is ready.
- Disabling a remote share prevents future retrieval but cannot remove local copies already imported.

## Internal retrieval to implement later

The future app will resolve an opaque share ID through its API, receive a short-lived read URL, `fetch` the private R2 object into bytes, and call the existing `importBoardArchive` with an in-memory `File`. It must show stages and useful failure/retry states. It must never call `downloadBoardArchive`, navigate to the archive URL, use a file picker, or require manual extraction. R2 access keys stay server-side. The existing `exportBoardArchive` returns the creator's `Blob`; `importBoardArchive` already performs extraction, limits, validation, and import. Minimal future changes are API handlers for create/complete/resolve/disable, authenticated creator controls, a client upload/fetch flow, and an origin-local `shareId → boardId` mapping that checks the board still exists. Server-side completion cannot directly reuse the browser-coupled `importBoardArchive`; it needs a small pure ZIP/manifest validation seam or a separately reviewed server validator. Progress can cover network bytes and named validation/import stages; the current synchronous extractor does not expose fine-grained unzip progress. No such changes are in this preparation branch.

## Proposed Preview configuration

**Proposal, not configured:** keep one private R2 bucket for this trial and store both archives and small status JSON objects there. The existing checkout has Vercel functions in `api/` and browser IndexedDB, but no server creator identity, shared database, or R2 integration. An R2-only metadata store avoids adding a second cloud service for a single creator, though concurrent transitions and cleanup require careful conditional writes. A database becomes preferable if the trial grows to multiple creators or high traffic. Prototype one full upload/disable cycle before committing to this design.

| Variable | Purpose | Visibility / Preview scope |
| --- | --- | --- |
| `BOARD_SHARE_R2_ENDPOINT` | R2 S3 endpoint, including account and jurisdiction, e.g. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. | Server only; Preview deployment for this branch. |
| `BOARD_SHARE_R2_BUCKET` | Name of the trial's private bucket. | Server only; Preview deployment for this branch. |
| `BOARD_SHARE_R2_ACCESS_KEY_ID` | Bucket-scoped S3 API access key ID. | Server only, secret; Preview deployment for this branch. |
| `BOARD_SHARE_R2_SECRET_ACCESS_KEY` | Matching S3 API secret. | Server only, secret; Preview deployment for this branch. |
| `BOARD_SHARE_CREATOR_PASSWORD_HASH` | JSON scrypt verifier for the one designated test creator's trial passphrase; exact format below. | Server only, secret; Preview deployment for this branch. |
| `BOARD_SHARE_SESSION_SIGNING_KEY` | 32 random bytes encoded as 64 hex characters; decoded before HMAC. | Server only, secret; Preview deployment for this branch. |
| `BOARD_SHARE_ALLOWED_ORIGIN` | Exact origin for browser requests and CSRF checks: `https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app`. | Server only; Preview deployment for this branch. |

Review template only; these placeholders are not usable credentials:

```dotenv
BOARD_SHARE_R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
BOARD_SHARE_R2_BUCKET=<PRIVATE_TRIAL_BUCKET_NAME>
BOARD_SHARE_R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
BOARD_SHARE_R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
BOARD_SHARE_CREATOR_PASSWORD_HASH=<JSON_SCRYPT_VERIFIER>
BOARD_SHARE_SESSION_SIGNING_KEY=<64_HEX_CHAR_KEY>
BOARD_SHARE_ALLOWED_ORIGIN=https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app
```

None uses a `VITE_` prefix. Do not place keys, passphrases, hashes, or signed URLs in the bundle, a share URL, logs, or this document. Use a random creator passphrase with at least 128 bits of entropy; store a salted scrypt verifier, not the passphrase. The creator enters it into a trial-only sign-in form over HTTPS; the API verifies it with a constant-time comparison and sets a one-hour HMAC-signed `Secure`, `HttpOnly`, `SameSite=Strict` cookie. All create, completion, and disable requests require that cookie plus an exact Origin check. Resolve remains public and returns a read URL only for a ready share. Rate limiting for failed sign-in attempts should use an available edge rule or a durable R2 counter; serverless process memory is insufficient. This is a proposed trial mechanism, not existing authentication; the app's Spotify and browser-held OpenAI credentials are unrelated. If Preview Deployment Protection requires a Vercel account, unauthenticated recipients will be blocked before the app runs and that setting needs a separate decision.

The verifier variable is a JSON string with this shape (placeholders are not values):

```json
{
  "version": 1,
  "algorithm": "scrypt",
  "N": 16384,
  "r": 8,
  "p": 1,
  "salt": "<EVEN_LENGTH_HEX_SALT>",
  "hash": "<128_HEX_CHAR_HASH>"
}
```

`api/_lib/creatorAuth.ts` now validates this format and derives a 64-byte hash asynchronously, comparing it with `timingSafeEqual`. It also rejects malformed signing keys, decodes the 64 hex characters into 32 bytes before HMAC, and verifies signatures with a constant-time comparison. `api/_lib/creatorAuth.test.ts`, the deployed-import check, and the build pass. No sign-in endpoint, cookie issuance, or sharing API uses these helpers yet.

Create a bucket-scoped **Object Read & Write** R2 S3 API token, with no bucket-admin permission. Keep the bucket private, without a public domain. Browser access uses only signed object-specific URLs. Proposed bucket CORS rule:

```json
[
  {
    "AllowedOrigins": ["https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "MaxAgeSeconds": 300
  }
]
```

The final signed request headers must match this rule exactly; remove headers not used by the implementation. `HEAD` is server-to-R2 and does not require browser CORS. Cloudflare documents [browser CORS for presigned URLs](https://developers.cloudflare.com/r2/buckets/cors/), [bucket-scoped API token permissions](https://developers.cloudflare.com/r2/api/tokens/), and [presigned URL behavior](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Use random, unguessable share IDs. Store `shares/<id>/status.json` with `pending`, `ready`, or `disabled`, timestamps, exact archive key, byte length, and SHA-256. Create status with `If-None-Match: *`; change it with `If-Match` on its current ETag. R2 documents atomic conditional writes and strong read-after-write consistency ([conditional operations](https://developers.cloudflare.com/r2/api/s3/conditional-operations/), [consistency](https://developers.cloudflare.com/r2/reference/consistency/)). Never use process memory for status.

Proposed upload URL lifetime: **15 minutes**. Upload to a unique staging key, not the final archive key. Sign `If-None-Match: *` into the browser PUT so a reused URL cannot overwrite the staged key. Completion must read the staged object, verify its size and SHA-256 against the creator's original digest, validate that it is an archive within trial limits, and copy it once to a final immutable key with a destination create-only condition. Publish `ready` only after the final object exists; only that final key is ever resolved. Concurrent completion/disable must obey conditional status transitions. Delete the staged object after completion. Proposed read URL lifetime: **2 minutes**, issued after each ready-status check. On disable, write the `disabled` tombstone and delete the final object; already imported local boards remain. A read URL issued just before disable may fail on fetch, which should show a clear unavailable state. Do not cache resolve responses.

Start with **32 MiB compressed** and **50 MiB unpacked** trial caps, plus the importer's existing per-note, per-image, count, and MIME checks. The 1,335-byte reference archive does not justify a higher trial cap. The importer currently accepts up to 260 MiB compressed and approximately 261 MiB expanded, and reads the full archive into browser memory; the lower trial cap limits network and memory exposure. Verify the cap against a real curated collection before freezing it. Reject oversized uploads before signing and again at completion and fetch. Pending statuses expire logically after 30 minutes; use an R2 lifecycle rule for staging objects after one day, plus a small scheduled or manual status sweep for stale pending records. Cloudflare documents [object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/). Keep disabled tombstones so old IDs cannot become valid again.

**Reasons this proposal may underperform:** R2 status JSON requires correct conditional updates and cleanup; a single bucket-scoped token grants broader object access than a per-object credential; a passphrase is weaker operationally than an existing identity provider; and 32 MiB may exclude realistic image boards. The trial should first prove signed PUT/GET, CORS, completion immutability, deletion, and the real curated-image round trip at the Preview origin.

## Next configuration steps

1. Supply the **public curated-feed base URL only** to finish the real R2 image round trip; do not send credentials. Confirm whether the Preview deployment currently has account-level protection that would block link recipients.
2. Choose or create a private, trial-only R2 bucket and a bucket-scoped Object Read & Write S3 token. Record its jurisdiction-specific S3 endpoint securely.
3. Set the exact Preview-origin CORS rule for the bucket. Do not make it public.
4. Review the variable template above, then enter actual values directly into the branch's Vercel Preview settings. Keep Production untouched.
5. Agree on the single test creator, choose the failed-sign-in rate limit, and provision their passphrase verifier and session signing key securely; do not send secret values in chat.
6. Approve the proposed R2 status-object design and size/lifetime limits, or select a durable database if concurrent sharing is expected. Only then implement and run a minimal end-to-end prototype in this branch.

## Implemented trial and operating instructions

This section describes the code in this branch. It supersedes the earlier proposal and configuration checklist. The real R2 service and deployed Preview have **not** been verified as part of this implementation; do not treat local mocks as evidence of Cloudflare behavior.

### API, access, and state

The single Vercel function `api/boardShares.ts` accepts `/api/boardShares?action=<action>`:

| Action | Method | Access | Result |
| --- | --- | --- | --- |
| `login` | POST | Exact allowed Origin; durable attempt budget | Verifies the passphrase and sets a one-hour `__Host-board-share-creator` cookie. |
| `logout` | POST | Creator session and Origin | Clears the cookie. |
| `session`, `list` | GET | Creator session | Checks sign-in or lists shares; `list` supports a `cursor` query. |
| `create` | POST | Creator session and Origin | Records digest and length, creates `pending`, returns a 15-minute staging PUT URL and its exact `Content-Type` / `If-None-Match` headers. |
| `complete` | POST | Creator session and Origin | Verifies staged bytes and archive, publishes final bytes conditionally, then changes status to `ready`. |
| `resolve` | GET | Public | Returns a two-minute final GET URL, length, and digest for a ready share. |
| `disable` | POST | Creator session and Origin | Writes a terminal disabled tombstone before deleting final and staging objects. |
| `cleanup` | POST | Creator session and Origin | Sweeps at most 100 staging and 100 share keys per call; accepts `stagingCursor` and `sharesCursor` in JSON and returns the next cursors. |

All API JSON responses use `Cache-Control: no-store`. `resolve` never returns metadata keys or bucket listings. All mutations require the exact configured Origin. The session cookie is Secure, HttpOnly, SameSite=Strict, Path=/ and HMAC signed with the **decoded 32-byte key**. The server assigns owner `trial-creator-v1`; client owner/key claims are ignored. The password verifier must be JSON with `version: 1`, `algorithm: "scrypt"`, `N: 16384`, `r: 8`, `p: 1`, a 16-byte hex salt, and a 64-byte hex hash. The signing variable is 64 hex characters representing 32 random bytes. Invalid or missing configuration fails closed with a non-secret diagnostic.

Sign-in attempts are reserved with conditional writes to R2 object `trial/sign-in-rate.json`. The global budget is **five attempts per 15 minutes**, including successful attempts. It neither uses process memory nor trusts a client IP header. An R2 outage prevents sign-in. This global limit can let unwanted attempts lock out the creator for the window; it is a trial trade-off, and live R2 conditional-write behavior remains a required gate before exposing sign-in.

Status lives at `shares/<id>/status.json`. Each status records schema version, random 48-hex share ID, server owner, `pending` / `ready` / `disabled`, timestamps, a 30-minute upload deadline, server-generated staging/final keys, expected length, and SHA-256. Creation uses `If-None-Match: *`; changes use current ETag with `If-Match`. The final object is at `shares/<id>/archive.board.zip`. Upload URLs address only a unique `staging/<id>/...board.zip` key and sign `If-None-Match: *`. Completion checks staged ETag, actual size, SHA-256, and bounded ZIP/manifest preflight before a create-only destination copy with a source ETag condition. The installed SDK's outgoing headers were inspected locally; R2 must still be tested live. A ready share has no fixed expiry. Disabled IDs are never reused.

`/share/<id>` is handled by the existing SPA rewrite while `/api/` stays routed to the function. The recipient opens an existing local share mapping first, otherwise resolves and fetches internally, checks streamed byte count and SHA-256, and imports through the existing archive importer. An IndexedDB `shareImports` store (database version 3) writes the mapping in the same transaction as the new board, notes, and assets. Web Locks coordinate tabs; the unique mapping is the cross-tab integrity guard. A stale mapping is removed when its board is missing. Creator and recipient copies remain independent. The UI shows named stages, a ready link only after completion, Copy link, retry, and a protected disable control. Existing recipient copies remain available after remote disable.

### Preview configuration

Set **only for this branch's Vercel Preview** the seven exact `BOARD_SHARE_*` variables in the table above. None has a `VITE_` prefix. Keep the bucket private. A bucket-scoped R2 S3 token needs Object Read & Write for the trial bucket, not bucket administration. The exact browser CORS rule is the JSON above: allowed origin is this branch's stable Preview origin; methods `GET` and `PUT`; request headers `Content-Type` and `If-None-Match`; no exposed response header is needed. Browser upload must send both signed headers. Server HEAD/COPY/LIST/DELETE do not need browser CORS. Use the R2 dashboard's lifecycle configuration to expire **only `staging/` objects after one day**. Do not expire `shares/` final archives, status tombstones, or `trial/` sign-in metadata. Check Preview deployment protection so a recipient without a Vercel account can reach the app and public resolve endpoint.

The 15-minute PUT and two-minute GET lifetimes are in code. The trial permits **32 MiB compressed** and **50 MiB expanded**, with the existing one-MiB-per-note, 10-MiB-total-notes, 25-MiB-per-image, count, MIME, and recipient schema checks. Server preflight bounds output as it decompresses and checks structural metadata; the browser importer remains the final panel/theme validator. Browser JavaScript cannot set `Content-Length` for a signed PUT. The implementation rejects oversized archive length before creating a URL and verifies actual R2 object length at completion, but an oversized object may occupy staging until cleanup/lifecycle. This must be checked against real R2 behavior and cost limits.

### Creator operation and cleanup

Open the branch Preview, choose **Share board**, enter the designated trial passphrase, then choose **Share this board**. Wait through preparing, uploading, and confirming. The displayed `/share/<id>` link is stable and contains no creator secret or R2 URL. Each click creates a fixed snapshot. A recipient opens the link without creator sign-in and receives an editable local board. The creator can reopen Share board to see references and disable a share. The UI states that already imported recipient copies remain usable. Logout clears the session cookie.

The protected **Clean up expired uploads** button sweeps one bounded batch. Repeat it for small trials. For a larger backlog, call the same protected `cleanup` action repeatedly with the returned cursors until both are absent, using the creator's authenticated browser session and exact allowed Origin. Never put a cookie or signed URL in a shell history or report. Cleanup changes expired pending statuses into disabled tombstones, removes abandoned/recreated staging objects, and removes final objects lacking a ready status. It is idempotent and can be repeated after failures. The one-day staging lifecycle is the backstop for a valid PUT URL that recreates a staging object after the last sweep. Cleanup is manual for this trial; no scheduler or extra secret is needed.

### Verification status and limits

| Check | Result | Evidence limit |
| --- | --- | --- |
| Existing baseline archive round trip with local PNG, notes, Music reference, theme, layout, camera, recipient edit and reload | Passed before implementation | Manual file export/import in two Chromium contexts, as recorded above. |
| `npx vitest run --maxWorkers=1` | Passed: 74 files, 659 tests | Includes creator auth, configuration, status/races, rate, bounded archive, and local SDK serialization; no real R2. |
| `npm run build` | Passed | TypeScript and Vite; existing large-chunk warning remains. |
| `npx playwright test browser-tests/board-share-receiver.spec.ts --project=chromium` | Passed: 3 tests | Direct route, refresh, no download event, deduplication, simultaneous tabs, and stale mapping with mocked resolve/archive responses. |
| `npx playwright test browser-tests/board-sharing-baseline.spec.ts --project=chromium` | Passed: 1 test | Real local manual archive export/import across clean browser contexts, with local PNG; latest archive 1,341 bytes. |
| Live R2 signed PUT/GET, CORS, destination condition, deletion, and upload replay | Untested | No trial R2 credentials or bucket in this worktree. |
| Real curated R2 image in a clean recipient context | Untested | Public curated-feed root is still unknown. |
| Deployed Preview sign-in, upload, receive, repeat open, and disable | Untested | Requires Preview variables, bucket/CORS, and a deployment of this code. |
| Production deployment identity before/after | Unverified | Do not infer Production state from the branch or repository. |

Local signed-header inspection proves what the installed SDK emits to a local test server, not that R2 accepts the custom destination create-only condition. Cloudflare's [conditional-write documentation](https://developers.cloudflare.com/r2/api/s3/conditional-operations/), [presigned URL guidance](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), and [CORS guidance](https://developers.cloudflare.com/r2/buckets/cors/) inform the implementation. The server preflight intentionally does not run the browser's panel/theme code; full validation occurs during recipient import. Spotify authentication/playback and other external links do not transfer. The real curated-image round trip remains a separate dependency.

### Remaining setup in order

1. Provide the **public curated-feed base URL** (root containing `collections/index.json`) for the real-image test; no credential is needed in chat.
2. Create/select the private trial R2 bucket and bucket-scoped Object Read & Write token. Test R2 conditional writes and the destination create-only copy with the actual service before enabling sign-in.
3. Apply the exact Preview CORS rule above and the one-day `staging/` lifecycle rule. Verify browser PUT and GET from the stable branch origin.
4. Generate the designated creator verifier and 32-byte signing key securely; enter all seven exact variables into **Preview for this branch only**. Do not send values in chat or put them in the repository.
5. Confirm recipients can access the branch Preview without creator or Vercel authentication. Run the live sign-in, share, clean recipient, repeat-open, disable, upload-replay, and cleanup checks; verify Production identity before and after a branch push. Keep Production configuration and domains untouched.
