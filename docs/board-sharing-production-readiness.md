# Anonymous board sharing: production readiness verification

**Review run:** 2026-11-27, 11:20–12:00 UTC (timestamps on individual checks below).
**Reviewer environment:** Windows 11 workstation, worktree `C:\local-dev\my-states-board-sharing`, Node 22.15.1, Vercel CLI 67.0.0 via `npx` (authenticated as the project's owning user), Cloudflare API via the authenticated Cloudflare connector (single account `b67121bd…ee392`), Playwright Chromium 153 headless.
**Supersedes:** the 2026-11-26 version of this file (baseline at `7ca99a1`, remediation `70066b9`/`a94b135`). Those findings (F1–F5, P1–P4) are summarised in §7; their full text is in git history. `docs/board-sharing-production-configuration.md` (untracked, dated 2026-11-27) was read as a source inventory, not as evidence of deployed settings.

No application code, cloud configuration, Production deployment, or Production data was changed. Nothing was committed, pushed, deployed, promoted or merged. No secret value was retrieved or printed; only non-secret configuration values (origins, bucket names, R2 account endpoint, curated-image root) were read. Every review-created R2 object was deleted (§1.5).

Status labels: **PASS** (observed or proven for the stated scope), **FAIL** (observed wrong or missing), **UNVERIFIED** (not observed; not a pass), **N/A**. Evidence labels: *live* = real Preview/Worker/R2 request in this run, *account* = authenticated Vercel/Cloudflare metadata in this run, *source* = code at the candidate SHA, *unit* = automated tests on the committed candidate, *docs* = current official documentation.

---

## 0. Verdict

**Ready after explicitly listed configuration** — the committed candidate's code passed every live, unit and build check run here, and no release-blocking code defect was found. Production is **not** configured: three required Production variables, the Production upload Worker, and a working cleanup schedule do not exist yet, and cleanup has never completed successfully in any environment. The configuration in §5 (items U1–U8, plus Codex item C1) must be done, and the Preview cleanup run (U3) observed succeeding, before merging to `main`. Production behaviour itself is unverified until the post-release smoke test in §6 passes.

**Single next action:** ~~Codex adds a tracked `worker/wrangler.production.jsonc` (C1)~~ — written and dry-run validated, not yet committed. Next: commit it, then the user deploys it (U1) to obtain the Production `BOARD_SHARE_UPLOAD_ORIGIN` that every other Production step depends on.

---

## 1. Exact reviewed and deployed versions

### 1.1 Release candidate

| Item | Value | Evidence / time |
|---|---|---|
| Branch | `experiment/board-sharing` | `git branch --show-current`, 11:20 UTC |
| HEAD | `b810fc1480d315a4c1b9d07d65999ff5db82c265` | `git rev-parse HEAD` |
| `origin/experiment/board-sharing` | `b810fc1480d315a4c1b9d07d65999ff5db82c265` (same) | `git fetch origin` then `git rev-parse` |
| `origin/main` | `d2c5335da1d36a8e8e5fe45f418b3f9f57f0fcd5` | same fetch |
| Working tree | ` M .gitignore` (adds `.vercel`, `.env*`); `?? docs/board-sharing-production-configuration.md`; this file once written | `git status --porcelain` |
| Local changes affecting sharing | **None.** The `.gitignore` edit and the untracked inventory doc do not change sharing behaviour. They are not part of the release candidate and should be committed separately or discarded. | `git diff` |
| Checks run against committed candidate | Yes: `git archive b810fc1` into an empty scratch directory, then `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev` (§1.4). | background run |

### 1.2 Vercel

| Item | Value | Evidence |
|---|---|---|
| Project | `music-images-canvas`, `prj_m2puygkB9RHAsdumpbHdydXOjUWV`, team `team_3BeuG09K7cr3Q4YBsMnxh0mg`, framework Vite, Node 24.x, functions `iad1`, Fluid on | *account*: `vercel api /v9/projects/…`; matches `.vercel/repo.json` (link metadata left as is) |
| Git link | GitHub `SingleColumn/my-states.xyz`, **production branch `main`** | *account* |
| Production deployment | `dpl_CRW21jCV7L2ChZUjqS6B5xw1RFuo`, SHA `d2c5335` (`main`), READY, created 2026-11-21T23:23:58Z. Does **not** contain board sharing (`/api/boardShares` → 404). | *account* + *live* |
| Preview deployment under test | `dpl_Aoeiw8xhmJLpX8AMayv8tuHgcy7b`, SHA **`b810fc1`** (= candidate), branch `experiment/board-sharing`, target preview, READY, created 2026-11-26T20:23:09Z | *account*: `/v6/deployments` |
| Stable Preview alias | `music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app` → `dpl_Aoeiw8xh…` (alias updated 2026-11-26T20:24:21Z) | *account*: `/v4/aliases/…` |

### 1.3 Cloudflare

| Item | Value | Evidence |
|---|---|---|
| Account | `b67121bd16cacda1a7a34ca5069ee392` (only account visible) | *account* |
| Upload Workers | **Only one exists:** `my-states-board-upload-preview`. No Production upload Worker exists. | *account*: `/workers/scripts` |
| Preview Worker version | Deployment `d562e605-397c-483f-98d2-f891f110a346`, version `789549c6-22b5-46ac-ac57-fc3298f47d54` (100 %), source wrangler, 2026-11-26T10:33:46Z. Compatibility date 2026-11-01. | *account* |
| Preview Worker origin | `https://my-states-board-upload-preview.my-states-xyz.workers.dev` (account subdomain `my-states-xyz`; workers.dev enabled; no custom domain or route; no cron triggers) | *account* + *live* |
| Preview Worker bindings | `BOARD_SHARES` → R2 `my-states-board-sharing-test`; `BOARD_SHARE_ALLOWED_ORIGIN` (plain text) = stable Preview alias origin | *account*: `/settings` |
| Worker source match | Deployed source (from the uploaded source map) SHA-256 `6aef218a…ffe4`, 5,545 bytes, is **byte-identical** to `worker/boardShareUpload.mjs` at `b810fc1` (and `70066b9`; unchanged since). | *account* + local `sha256sum` |

**Version consistency:** local HEAD = remote branch = Preview deployment SHA; deployed Worker source = HEAD Worker source. No mismatch found. Production runs older code (`d2c5335`) without sharing; that is expected before release.

### 1.4 Local verification of the committed candidate

Run 2026-11-27T11:47:01–11:53:39Z on a clean `git archive b810fc1` extraction (no working-tree files), Node 22.15.1 / npm 10.9.2:

| Step | Result |
|---|---|
| `npm ci` | PASS (485 packages) |
| `npm test` (Vitest + `node --test scripts/*.test.mjs`) | **PASS**: 76 files / 670 Vitest tests; 13/13 Node tests (includes `scripts/board-share-upload.test.mjs` Worker tests); exit 0 |
| `npm run build` (manifest generation, `tsc -b`, Vite) | **PASS**; only the existing >500 kB chunk warning |
| Built bundle scan for `BOARD_SHARE_`, `R2_SECRET`, `SESSION_SIGNING`, `CRON_SECRET`, `r2.cloudflarestorage.com` | **PASS**: no match in `dist/` |
| `npm audit --omit=dev` | 29 advisories (1 low, 28 moderate, **0 high/critical**) — the feed changed since the 2026-11-26 zero result. Reachability: `@tiptap/core` ≤3.30.3 (GHSA-cp6q-959q-f8rh, via `tldraw@3.15.6`; fix needs a tldraw major upgrade) is **not reachable from share import**, because archives carry the app's own panel/notes format, not tldraw documents (`src/boardArchive.ts` comment and code, source assessment). `dompurify` ≤3.4.16 (low, via `posthog-js`) is in PostHog's own UI code, not the share path. The rest are the same tldraw/tiptap chain. Not release-blocking for sharing; track separately. |

Playwright browser tests (`npm run test:browser`) were not re-run in this review; the live Preview flow in §2.12 replaced them for sharing.

### 1.5 Objects created by this review and their cleanup

| Created | Where | Cleanup |
|---|---|---|
| Share A (boundary test): `shares/<A>/status.json` (pending), `staging/<A>/<rand>.board.zip` (1,024 B synthetic random bytes) | test bucket | Deleted 2026-11-27T11:52:02Z |
| Share B (browser flow): status (ready), staging and final archive (small synthetic board with fixture images) | test bucket | Deleted 2026-11-27T11:52:02Z |
| Two create reservations and three resolve rows inside `trial/share-usage-v1.json` / `trial/resolve-usage-v1.json` | test bucket | **Left in place** (rewriting the shared ledgers is riskier than letting rows age out: create rows after 24 h, resolve rows after 15 min) |
| One manual schedule execution `schx_6HPCJ8P7JWDC5C127N34BJZ2NR` | Vercel Preview | Not removable; counts as 1 of the 5,000 runs/billing period on Hobby; no data changed (401) |
| Scratch scripts/logs/screenshots | session scratchpad only | Not added to the repo |

Test bucket after cleanup: 26 objects (identical count to before the review). The diagnostic scripts were *not* added to the repository; `scripts/diagnose-preview-sharing.mjs` (existing) was reused as the basis for an extended scratch copy.

---

## 2. Checklist

### 2.1 Release candidate (prompt §1)

| Check | Result | Evidence |
|---|---|---|
| Branch, HEAD, remote SHA, working tree recorded | PASS | §1.1 |
| Local modifications affecting sharing | PASS (none) | `git diff`: only `.gitignore` |
| Intended release changes separated from unrelated work | PASS | The untracked inventory doc and `.gitignore` edit are not in the candidate |
| `origin/main` and Production SHA recorded | PASS | `d2c5335` both |
| Checks run on committed candidate | PASS | clean `git archive` checkout, §1.4 |
| Preview ID, SHA, environment, status | PASS | `dpl_Aoeiw8xh…`, `b810fc1`, preview, READY |
| Worker name, version, account, origin | PASS | §1.3 |
| Tested Worker matches reviewed source | PASS | byte-identical SHA-256 |
| Mismatches | PASS (none) | |

### 2.2 Platform access (prompt §2)

| Check | Result | Evidence |
|---|---|---|
| Vercel identity, team, project ID | PASS | CLI `whoami` and project read. The Vercel MCP connector returned 403 for this team scope; the CLI via `npx` was authenticated and used instead (no reauthorisation requested). |
| CLI availability | PASS | `npx vercel@latest` 67.0.0 |
| Repository link metadata respected | PASS | `.vercel/repo.json` already names the expected project/team; not modified. CLI calls used `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` in-process only. |
| `main` is the production branch | PASS | `link.productionBranch = main` |
| Production domains/redirects | PASS | `my-states.xyz` → 308 → `www.my-states.xyz`; `www.my-states.xyz` serves Production; `music-images-canvas.vercel.app` also attached |
| Cloudflare account selected | PASS | one account |
| Test and Production sharing buckets | PASS | `my-states-board-sharing-test` (2026-11-23), `my-states-board-sharing-production` (2026-11-27, **empty**); plus unrelated `image-library` |
| Test and Production upload Workers | **FAIL** | Only the Preview Worker exists (§5 U1) |
| External settings actually inspected | — | Vercel: project, protection, domains, env-var metadata, non-secret env values, deployments, aliases, schedules, schedule executions, request logs. Cloudflare: buckets, CORS, lifecycle, r2.dev, custom domains, bucket locks, event notifications (none), Worker settings/bindings/deployments/versions/source/subdomain/domains/cron, account API tokens and their policies, object listings and status metadata in the test bucket. **Not inspected:** Cloudflare plan/billing and Worker spend controls, user-owned (non-account) API tokens (403), PostHog project, Vercel spend management, WAF/firewall rules. |

### 2.3 Origins and anonymous access (prompt §3)

| Check | Result | Evidence |
|---|---|---|
| Canonical Production origin after redirects | PASS | *live* 11:46:33Z: `https://my-states.xyz/` 308 → `https://www.my-states.xyz/` 200 |
| Configured allowed origin matches | PASS (Production value present) | Production `BOARD_SHARE_ALLOWED_ORIGIN` = `https://www.my-states.xyz` exactly (25 chars, no slash/whitespace). Production R2 CORS uses the same origin. |
| Generated links use that origin | PASS (source) / UNVERIFIED (Production) | Link = `${allowedOrigin}/share/${id}` (`api/boardShares.ts`). On Preview the link origin observed = Preview alias. |
| Direct `/share/<id>` and refresh | PASS on Preview; Production UNVERIFIED | Preview: `/share/<48-hex>` → 200 SPA; recipient direct navigation + reload worked (§2.12). `vercel.json` rewrite excludes `/api/`. Production today returns 200 SPA but API 404 (sharing not deployed). |
| No Vercel Authentication / Access / passphrase / registration for recipients | PASS on Preview alias and by configuration for Production; Production behaviour UNVERIFIED | Project `ssoProtection = all_except_custom_domains`: custom domain `www.my-states.xyz` is exempt. On Preview, per-deployment URLs redirect to Vercel SSO (302) but the stable branch alias has an `alias-protection-override` bypass (created 2026-11-23) and served 200 anonymously. No Cloudflare Access app in the Worker path (Worker answered directly). Creator and recipient contexts had 0 cookies and no login. |
| Bot/abuse controls do not demand authentication | PASS | No CAPTCHA/Turnstile/BotID in source; limits are IP-ledger based. No Vercel firewall rule inspected (not listed). |
| `BOARD_SHARE_UPLOAD_ORIGIN` is the Worker origin | PASS (Preview) / **FAIL (Production: missing)** | Preview value = Worker workers.dev origin; not the app origin, not the R2 S3 endpoint. |

Behaviour that necessarily remains for after release: canonical-origin link generation, direct navigation/refresh on `www`, anonymous access on the custom domain, R2 GET CORS from `www` (§6).

### 2.4 Environment variables and secrets (prompt §4) — see matrix in §4

| Check | Result | Evidence |
|---|---|---|
| Inventory derived from current code | PASS | `readShareConfig` reads exactly seven `BOARD_SHARE_*` keys; `boardShareCleanup.ts` reads `BOARD_SHARE_CLEANUP_ALERT_URL`; `boardShares.ts` reads platform `VERCEL`; Worker reads `BOARD_SHARE_ALLOWED_ORIGIN` + `BOARD_SHARES`; operator script reads `BOARD_SHARE_ALLOWED_ORIGIN` + `BOARD_SHARE_SESSION_SIGNING_KEY`; `CRON_SECRET` is read by Vercel's scheduler, not code. No other sharing variable. |
| `BOARD_SHARE_CREATOR_PASSWORD_HASH` unused | PASS (unused) / obsolete copy remains | No reference in `api`, `src`, `worker`, `scripts`, `vercel.json`. **An obsolete Sensitive copy remains in Preview (branch `experiment/board-sharing`, id `tv0OnDkA…`).** Not deleted. Production has none. |
| No `VITE_` server secrets / not bundled | PASS | No `VITE_`-prefixed sharing/R2/signing variable in Vercel; client reads only general `VITE_*` config; built bundle contains none of the server names or the R2 endpoint host (§1.4). |
| Preview branch targeting | PASS | All eight Preview sharing variables are scoped `preview` + `gitBranch = experiment/board-sharing` |
| Production values use production resources | PASS for the 5 present | bucket `my-states-board-sharing-production`; endpoint = account S3 endpoint (default jurisdiction, matches bucket); origin `www`. |
| Production variables complete | **FAIL** | Missing in Production: `BOARD_SHARE_UPLOAD_ORIGIN`, `BOARD_SHARE_SESSION_SIGNING_KEY`, `CRON_SECRET` (required); `BOARD_SHARE_CLEANUP_ALERT_URL` (optional in code). `readShareConfig` would make every sharing request return 503. |
| Independent Preview/Production credentials | PASS (policy) / UNVERIFIED (values) | Cloudflare has separate account tokens `my-states-board-sharing-test` and `…-production`, each scoped to its own bucket only. Vercel stores the R2 key/secret as *Sensitive* (unreadable); which token each Vercel value belongs to cannot be read without disclosure. Production values were created 08:09 UTC, eight minutes after the Production token was issued (consistent, not proof). |
| Independent signing secrets | N/A until Production key exists | |
| Values that must match across surfaces | PASS (identified) | Per environment: Vercel `BOARD_SHARE_R2_BUCKET` = Worker `BOARD_SHARES` bucket (Preview: both `my-states-board-sharing-test` ✔); Vercel `BOARD_SHARE_ALLOWED_ORIGIN` = Worker `BOARD_SHARE_ALLOWED_ORIGIN` (Preview: identical ✔) = R2 CORS origin; Vercel `BOARD_SHARE_UPLOAD_ORIGIN` = Worker URL (Preview ✔); `CRON_SECRET` = `BOARD_SHARE_SESSION_SIGNING_KEY`. |
| `CRON_SECRET` equality established from code | PASS | `boardShareCleanup.ts` forwards the request unchanged to the cleanup action; `hasOperationsKey()` accepts only `Bearer <64 lowercase hex>` and constant-time compares the decoded bytes with `BOARD_SHARE_SESSION_SIGNING_KEY`. Vercel sends `Authorization: Bearer <CRON_SECRET>` (*docs*). So `CRON_SECRET` must equal the signing key in lowercase-hex form. |
| Secret equality compared safely | N/A — **`CRON_SECRET` does not exist in any environment** | The live Preview invocation returned 401 (§2.10). |
| Deployment created after variable changes | PASS (Preview) / N/A (Production) | Last Preview sharing variable change 2026-11-26T11:57:58Z < Preview deployment 20:23:09Z. Production variables (2026-11-27) post-date the current Production deployment; the release deployment must be created after all U-items. |

### 2.5 R2 isolation and permissions (prompt §5)

| Check | Result | Evidence |
|---|---|---|
| Production bucket separate from test and image library | PASS | three distinct buckets |
| Public development URL disabled | PASS | `domains/managed.enabled = false` for both sharing buckets; *live* r2.dev URLs → 401 |
| No public custom domain on sharing buckets | PASS | `domains/custom = []` for both (image library has `library.endlessmoment.xyz`, as intended) |
| Credentials restricted to bucket and operations | PASS (policy) | Each sharing token: single permission group "Workers R2 Storage Bucket Item Write" (object read/write/delete/list within the bucket; no bucket admin) on exactly one bucket resource |
| Cross-environment access impossible | PASS (policy) / UNVERIFIED (Vercel value ↔ token mapping) | Policies name one bucket each. No credential-based probe was made (it would require the secret). |
| Endpoint/jurisdiction | PASS | Both buckets jurisdiction `default`, location WEUR; endpoint `https://b67121bd…ee392.r2.cloudflarestorage.com` (no `.eu`) |
| Worker binding names intended bucket | PASS (Preview) / FAIL (Production Worker absent) | |
| Test Worker cannot write Production bucket | PASS | Its only R2 binding is the test bucket; Worker has no S3 credentials |
| Browser uploads object-specific and narrowly authorised | PASS (*live*) | Route `/upload/<48-hex>` only; key chosen server-side from status; per-share 256-bit token checked against stored SHA-256 verifier |
| No public listing / arbitrary key / unrestricted operations | PASS (*live* + source) | Worker rejects unknown paths (404), query strings, wrong Origin (403), missing/forged token (403). API has no list/read-by-key; traversal-shaped ID → 400. |

### 2.6 Worker upload enforcement and CORS (prompt §6)

Browser request sequence observed on Preview: `POST /api/boardShares?action=create` (201) → `OPTIONS` + `PUT https://my-states-board-upload-preview.my-states-xyz.workers.dev/upload/<id>` with `Content-Type: application/zip`, `Authorization: Bearer <64-hex token>` (200) → `POST …?action=complete&id=<id>` with JSON `{uploadToken}` (200) → recipient `GET …?action=resolve&id=<id>` (200) → `GET` signed R2 URL. No direct browser→R2 PUT exists.

| Check | Result | Evidence (*live* 2026-11-27T11:48:34–46Z unless noted) |
|---|---|---|
| Route, method, headers, token, lifetime | PASS | Above. Token valid while status is `pending` and before `uploadDeadline` = create + 30 min. |
| Worker authorisation matches issuer | PASS | Worker recomputes SHA-256(token) against `uploadVerifier` written by the API |
| Token bound to share/object/size/digest/deadline | PASS | Share ID in route and status; staging key from status; exact `byteLength` from status; deadline from status. Digest is checked at completion (not in Worker). |
| Missing/forged/expired/mismatched rejected | PASS | forged token 403; no token 403 (on random ID); wrong Content-Type 415; wrong Origin preflight 403. Expired: source + unit only (UNVERIFIED live; would need a 30-min wait). |
| Cap enforced before an oversized object is stored | PASS | Declared 1,024 B: PUT 1,025 B with honest Content-Length → 413; PUT 1,025 B **chunked, no Content-Length** → 413; PUT 1,023 B chunked → 409; then exact 1,024 B → 200 (proves no object existed after the rejections, otherwise 412); stored object = 1,024 B. |
| No unbounded allocation before checking | PASS (source) | Worker streams through `FixedLengthStream`, holds one byte back, aborts at declared+1 |
| Streaming bytes bounded, not only Content-Length | PASS (*live* chunked case) | |
| 32 MiB absolute cap | PASS | create declaring 32 MiB + 1 → 400; Worker also refuses status `byteLength` > 32 MiB |
| Provider limits support a valid 32 MiB archive | PASS (docs, prior) / UNVERIFIED (plan) | Workers body limit 100 MB on Free/Pro per Cloudflare limits page (cited in prior review, not re-read). Account plan not inspected. A full 32 MiB live upload was not run. |
| Final archive cannot be overwritten by old authorisation | PASS | Replay of the exact bytes → 412; different bytes → 412; Worker accepts only while status is `pending`; final key is written only by the API's create-only copy. |
| CORS — Worker upload | PASS | Preflight from Preview origin → 204, `Allow-Origin` exact, `Allow-Methods: PUT`, `Allow-Headers: Authorization, Content-Type`, `Max-Age: 600`, `Vary: Origin`; actual responses carry the exact origin. Matches the browser's real request (browser upload succeeded). |
| CORS — R2 recipient download | PASS on Preview (browser import succeeded) / config-only for Production | Test bucket allows the Preview origin; Production bucket allows `https://www.my-states.xyz`. **Both rules also allow `PUT` with `Content-Type`/`If-None-Match` (and Production exposes `ETag`) — obsolete from the old presigned-PUT design.** Not removed during review (§5 U6). Simple GET needs no request headers; `Content-Length` is safelisted. |
| CORS — curated-image source | PASS (config, Production) / UNVERIFIED (behaviour) | `image-library` (custom domain `library.endlessmoment.xyz`, = Production `VITE_IMAGE_COLLECTIONS_BASE_URL`) allows GET/HEAD from `https://www.my-states.xyz` and `https://my-states.xyz`. It does **not** allow the Preview origin, and Preview has no `VITE_IMAGE_COLLECTIONS_BASE_URL`, so curated-image export could not be tested before release. |
| Oversize test cleanup | PASS | No oversized object was ever stored; the 1 KiB test objects were deleted |

### 2.7 API and archive validation (prompt §7)

| Check | Result | Evidence |
|---|---|---|
| Body byte limit before allocation | PASS (*live*) | 2,049-byte JSON with Content-Length → 413; 3,000-byte **chunked** body (no Content-Length) → 413. Vercel ingress may still buffer up to its own limit before the handler (platform behaviour). |
| Missing/misleading length, chunked, multibyte | PASS (live chunked) + unit (multibyte/misleading) | `shareApi.test.ts` |
| Methods, Content-Type, actions, schemas | PASS (*live*) | `text/plain` → 415; extra field → 400; unknown action → 404; wrong Origin → 403 |
| IDs and keys cannot traverse | PASS (*live*) | `id=../trial/…` → 400; keys are server-generated |
| Compressed/expanded/entry/image/note/manifest limits, during decompression | PASS (unit/source) | `shareArchive.ts`; `shareArchive.test.ts`; not repeated live |
| Duplicate entries, versions, references, malformed, high-expansion rejected | PASS (unit) | same |
| Digest is not a substitute for content validation | PASS (*live*) | Random bytes with a correct declared digest uploaded fine but completion → **422 "The board archive has no manifest."** |
| Safe rendering / no automatic code execution | PASS (source, prior review) / adversarial content UNVERIFIED | Notes via Milkdown, images as blobs; no shared script path. No new adversarial Markdown/SVG test was run in this review. |
| Failed import leaves no partial state | PASS (unit) | single IndexedDB transaction (`storage.ts`) per prior remediation tests |
| Dependency advisories | PASS (reachability assessed) | 29 moderate/low, none reachable from share import by source assessment (§1.4) |

### 2.8 State transitions, expiry, races (prompt §8)

| Check | Result | Evidence |
|---|---|---|
| Ready only after validation/publication | PASS (*live*) | Pending share: resolve → 409, completion before upload → 409, invalid archive → 422 and stays pending |
| Contents fixed | PASS | create-only staging and final; replay 412 |
| 24 h from first publication; retries don't extend | PASS (source + unit; live timestamps) | Live test records: every ready record has `expiresAt − publishedAt = 86,400,000 ms` exactly. Dialog showed “until 28 nov, 12:50” for a share published 2026-11-27 ~11:50 UTC (local time display). |
| Server supplies and enforces timestamps | PASS (*live*) | A Preview test share whose `expiresAt` was 2026-11-25T22:25Z, with its archive **still present**, resolved → **410 “This share has expired.”** at 11:52:40Z. Disabled share → 410. |
| Signed download ≤ share deadline | PASS (source/unit) | `min(120 s, expiresAt − now − 5 s)` |
| Resolve/caching do not defeat expiry | PASS (*live* headers) | API `Cache-Control: no-store`; resolve rechecks every time |
| Cleanup/publication races, CAS, failed copies/deletes, staging recreation | PASS (unit) / real-R2 concurrency UNVERIFIED | Not raced live |
| Expired/disabled cannot be resurrected | PASS (source/unit) | Worker requires `pending`; complete rejects disabled/expired |
| Legacy records without expiry | **Accepted limitation, test bucket only** | One legacy ready record (no `expiresAt`) in the **test** bucket still resolves → 200 with a signed URL. Production bucket is empty, so no legacy record can reach Production unless copied. Retirement policy: disable it in the test bucket via the protected `disable` action once the Preview operations key is usable (U3). |

### 2.9 Abuse controls (prompt §9)

Values (source, `api/_lib/shareService.ts`; not load-tested): creates 4/source/15 min and 12/source/24 h; 100 global/24 h; pending 4/source and 20 global until the 30-min deadline; 512 MiB declared active bytes/24 h; ≤5 valid-token completion attempts/share; resolves 60/source and 1,000 global per 15 min; upload replay prevented by create-only write plus pending-only Worker. Reservations release at the deadline; abandoned bytes stop counting after 30 min; create rows age out after 24 h.

| Check | Result | Evidence |
|---|---|---|
| Limits survive instances/concurrency | PASS (design/unit) | R2 ETag compare-and-swap ledgers; not load-tested |
| Source address from verified platform behaviour | PASS (*docs*) | Vercel docs: `x-forwarded-for` is overwritten and external IPs are not forwarded. Code trusts it only when `VERCEL=1`, HMACs it with the signing key. |
| Not only client-resettable identifiers | PASS | IP-based, server-side |
| Shared-network retry guidance | PASS (source) | 429 messages include a retry time or “about 30 minutes” |
| Required edge rule configured | N/A | No edge rule is required by the design |
| Emergency create-only stop | **FAIL (accepted gap, not blocker)** | No code switch; a Vercel firewall rule on `POST /api/boardShares?action=create` is possible but none exists and none was tested. Removing env vars would also break resolve/cleanup. |
| Storage vs request vs cost exposure | — | Storage: actual staged bytes ≤ declared (live-proven) ≤ 32 MiB/share, ≤ 512 MiB declared/day, ×2 while staging is retained. Requests: resolve and create ledgers cap API calls that reach the handler; rejected Worker uploads, signed-GET reuse (≤120 s) and platform-level requests are not capped. Cost: no spending cap exists; Cloudflare/Vercel spend controls were not inspected. None of these is a complete spending cap. |

### 2.10 Cleanup and scheduling (prompt §10)

| Check | Result | Evidence |
|---|---|---|
| Route, method, format, authorisation | PASS | `POST /api/boardShareCleanup`, empty body (or JSON cursors to the underlying action), `Authorization: Bearer <64 lowercase hex = signing key>`; unauthenticated → 401 (*live*) |
| Mechanism | PASS | **Vercel Schedules** (beta, `schedules` key in `vercel.json`), not legacy Cron (*docs* + *account*: schedule `sch_01M8BW6X…`, source `static`, target type `path`, `requestMethod: POST`). |
| Method compatibility | PASS | Schedules path targets send POST by default; `requestMethod` may be GET or POST (*docs*: Schedules configuration). The handler accepts POST. Legacy Cron (GET) is not used. |
| Plan support for frequency | PASS (*docs*) | Account plan Hobby; Schedules minimum interval on Hobby = every 15 min (jitter fixed at 15 min); hourly allowed; 5,000 runs/billing period. |
| Deployed/enabled | **FAIL** | Preview: schedule exists but `state: inactive` (Preview static schedules start inactive per docs). Production: no schedule (sharing not deployed). |
| Preview vs Production | — | Static schedules run per environment; the Production one will be created by the release deployment. |
| Run history | PASS (inspected) | Preview: 0 scheduled executions; 1 manual execution by this review |
| Successful test-resource cleanup observed | **FAIL** | Manual invoke 2026-11-27T11:50:59Z → execution `schx_6HPCJ8P7…` **failed**; request log `POST /api/boardShareCleanup 401` at 11:51:04Z. Consistent with `CRON_SECRET` missing (Vercel then sends no Authorization). The test bucket has no `trial/cleanup-state-v1.json`, so cleanup has **never** succeeded there; two expired shares still hold archives and staging. |
| Missing/incorrect authorisation rejected | PASS (*live*) | 401 for no key on both routes |
| Whether Vercel Deployment Protection blocks schedule runs | UNVERIFIED | The request reached the deployment and returned 401; whether the 401 came from the handler or from protection cannot be distinguished in the request log. Production targets on custom-domain-exempt protection are also unverified until a Production run is observed. |
| Bounded paging reaches later pages; cursors; concurrency | PASS (unit/source) | 100 + 100 keys per run, durable CAS cursor; no exclusive lock |
| Expired/abandoned/recreated/orphaned handled; metadata retained | PASS (unit/source) | status kept 30 days |
| Delete failures retried | PASS (source) | cursor advances only after a fully successful page |
| One invalid status aborts the page | **Accepted limitation** | `cleanup()` calls `readStatus()` without per-record isolation; a malformed `status.json` would fail every run on that page (5xx, alert if configured). All 12 current test records pass the validator (checked this run); status files are server-written. Optional hardening (C3). |
| Last success/backlog/failures observable | PARTIAL | Response body and R2 state object; Vercel execution history. No read-only status endpoint. |
| Alerting | **FAIL (not configured)** | `BOARD_SHARE_CLEANUP_ALERT_URL` absent in both environments; even when set, it covers 5xx only, not 401 or missed runs. |
| R2 lifecycle | **FAIL (not configured)** | Both sharing buckets have only Cloudflare's default “abort multipart after 7 days” rule; no `staging/` expiry rule. No rule could delete `shares/` or `trial/` (✔). Lifecycle is a supplement, not the expiry mechanism (✔ by design). |
| Production cleanup invoked | N/A — not done, per instructions |

### 2.11 Privacy and observability (prompt §11)

| Check | Result | Evidence |
|---|---|---|
| Share IDs redacted before PostHog / Vercel Analytics | PASS (source/unit) | `redactShareAnalytics` on PostHog `before_send` (both desktop and mobile branches) and Vercel `<Analytics beforeSend>` |
| Pageview, session-entry, referrer, navigation, custom events, errors covered | PASS (source/unit) | Recursive redaction of keys and values; `Referrer-Policy: no-referrer` header observed live on Preview and Worker responses |
| Actual outgoing analytics from a Preview share | **UNVERIFIED** | On Preview, Vercel Analytics loaded `/_vercel/insights/script.js` (7 loads) but sent no event during the run; PostHog is not configured for Preview (`VITE_POSTHOG_*` are Production-only). 0 leaks in what was sent; nothing substantive to inspect. Must be checked on Production immediately after release (§6). |
| No token/signed URL/board content/secret in analytics or logs | PASS for observed traffic | 0 requests to third-party hosts contained the share ID; no Referer carried it. Vercel request logs record paths with share IDs and query strings (platform behaviour). |
| Infrastructure log retention/access | UNVERIFIED | Not inspected (Vercel/Cloudflare plan defaults apply) |
| Non-sensitive failure classes and timings | PARTIAL | HTTP statuses and generic messages; no structured metrics |
| Historical analytics exposure | Unchanged from prior review | Production never had sharing, so Production analytics cannot contain share IDs. Preview analytics before the redaction fix may; not inspected. |

### 2.12 User flow on Preview (prompt §12)

Run 2026-11-27T11:50:10–11:50:37Z, Playwright Chromium 153 headless, 1440×900, three isolated contexts (creator, recipient, two-tab recipient), against `dpl_Aoeiw8xh…` / Worker `789549c6…` / test bucket.

| Check | Result | Evidence |
|---|---|---|
| Share visible, usable without prior cookies | PASS | 0 cookies in each context before use |
| Preparing/uploading/confirming accurate | PASS | Status sequence observed: “Preparing this board…”, “Uploading this board…”, “Confirming the share…” |
| Link only after publication | PASS | Link field appeared 248 ms after `complete` 200 |
| Copy link | PASS | Clipboard text equals link; button changed to “Copied”. Fallback: read-only field selects on focus; copy failure shows “Select and copy it instead.” |
| Expiry and retained-copy wording | PASS | “Anyone with the link can open it for 24 hours.” → “Link available for 24 hours, until 28 nov, 12:50. People who already opened and saved the board keep their own copies after the link expires.” |
| No download dialog / file picker / extraction | PASS | 0 downloads, 0 file-chooser events (fixture images were loaded into the creator's board via the test file input before sharing) |
| Local-image board opens | PASS | Recipient image is a `blob:` URL with natural width > 0 |
| Curated R2-image board | UNVERIFIED | Not possible on Preview (no feed variable; image-library CORS excludes Preview origin) |
| Imported bytes independent of source | PASS (local images) | blob-backed image in a separate browser context |
| Notes, theme, layout, camera at matched viewport | PASS for theme/layout/camera/image; notes UNVERIFIED live | Creator and recipient screenshots at 1440×900 match (theme “Global (Minimal)”, three panels in identical positions, same image). The fixture board had no note text; notes fidelity rests on unit/local tests. |
| Recipient edits don't affect source | PASS | Recipient rename persisted; creator board unchanged after reload |
| Edits persist after reopening | PASS | Reload of the share link reopened the edited local copy |
| Simultaneous tabs don't duplicate | PASS | Two tabs opened the link at once: exactly **one** resolve request; both reached “Continue to board” (second used the local mapping) |
| Stale mapping recovery | PASS (unit) / not live | |
| Imported boards usable after remote expiry | PASS (source/unit) / not live | Local mapping checked before resolve |
| Missing local copy + expired remote → expired state | PASS (*live* API) | Expired share → 410 “This share has expired.”; receiver shows API error text with “Try again” / “Open my boards” |
| Browsers | Chromium only | No Safari, Firefox, Edge, iOS or Android claim. Phones get the generic desktop-only notice (`DesktopOnlyNotice`), not a share-specific message. |

Observation: the “Welcome to my-states.xyz” first-run dialog opens over the received board after “Continue to board”, so a first-time recipient dismisses two dialogs. Minor UX, not blocking.

### 2.13 Release and rollback preparation (prompt §13)

| Check | Result | Evidence |
|---|---|---|
| Tests/build pass for committed candidate | PASS | §1.4 |
| Production configuration ready | **FAIL** | §5 |
| No unresolved release-blocking defect | PASS (code) | No code defect found that blocks release; blockers are configuration |
| Post-release smoke test written | PASS | §6.1 |
| Monitoring/cleanup ownership explicit | PASS (assigned in §5) / not yet in place | |
| Rollback preserves resolution/cleanup | PASS (procedure, §6.2) | |
| Rollback does not assume objects/upload authorisation disappear | PASS (§6.2) | |

---

## 3. Findings

### 3.1 Confirmed defects (code)

None release-blocking. Non-blocking:

- **D1 — stale test.** `browser-tests/board-share-request-headers.spec.ts` still asserts the obsolete direct-to-R2 presigned PUT headers. It gives false assurance about upload CORS. *Owner: Codex.*
- **D2 — cleanup poison record.** One unreadable/invalid `status.json` aborts the whole cleanup page every run (§2.10). No such record exists today. *Owner: Codex (optional).*

### 3.2 External setup gaps (all must be closed before release unless marked optional)

1. Production upload Worker does not exist (no tracked Production Wrangler config).
2. Production `BOARD_SHARE_UPLOAD_ORIGIN`, `BOARD_SHARE_SESSION_SIGNING_KEY`, `CRON_SECRET` missing.
3. `CRON_SECRET` missing in Preview; the Preview schedule is inactive; cleanup has never succeeded; expired test archives remain.
4. Cleanup failure alert URL not configured (Preview and Production) — strongly recommended.
5. R2 CORS on both sharing buckets still allows `PUT`/`If-None-Match` (and Production exposes `ETag`) — obsolete; reduce to `GET`.
6. No `staging/` lifecycle rule (optional safety net).
7. Obsolete `BOARD_SHARE_CREATOR_PASSWORD_HASH` remains in Preview (harmless; remove).
8. Analytics payload redaction not observable on Preview (verify immediately after release, or optionally configure PostHog for Preview first).

### 3.3 Accepted limitations

IP-based limits (shared networks, IP rotation); no create-only kill switch; no spending cap; legacy no-expiry record in the test bucket only; cleanup alert covers 5xx only; Chromium-only browser evidence; curated-image sharing verified only by configuration before release; recipient sees the first-run welcome dialog; real-R2 concurrency races covered by unit tests only.

---

## 4. Configuration matrix (no secret values)

“Verified” means the evidence named; Sensitive values were never read.

| Surface | Name | Kind | Req. | Format | Preview (`experiment/board-sharing`) | Production | Value correctness |
|---|---|---|---|---|---|---|---|
| Vercel API | `BOARD_SHARE_R2_ENDPOINT` | Config (Encrypted) | Required | `https://<32hex>[.eu\|.us\|.fedramp].r2.cloudflarestorage.com` | present (2026-11-23) | present (2026-11-27 08:06Z) | Read: both = account `b67121bd…` default endpoint; matches buckets' jurisdiction ✔ |
| Vercel API | `BOARD_SHARE_R2_BUCKET` | Config | Required | bucket name | `my-states-board-sharing-test` ✔ | `my-states-board-sharing-production` ✔ | Read; equals Preview Worker binding ✔; Production Worker n/a |
| Vercel API | `BOARD_SHARE_R2_ACCESS_KEY_ID` | Secret (Sensitive) | Required | ≥10 chars | present | present (08:09Z) | UNVERIFIED value; Preview works live with test bucket |
| Vercel API | `BOARD_SHARE_R2_SECRET_ACCESS_KEY` | Secret (Sensitive) | Required | ≥20 chars | present | present (08:09Z) | as above |
| Vercel API + Worker + R2 CORS | `BOARD_SHARE_ALLOWED_ORIGIN` | Config | Required | exact HTTPS origin | stable Preview alias ✔ (equals Worker var and test CORS) | `https://www.my-states.xyz` ✔ (equals Production CORS) | Read and compared |
| Vercel API | `BOARD_SHARE_UPLOAD_ORIGIN` | Config | Required | HTTPS origin of the Worker | `https://my-states-board-upload-preview.my-states-xyz.workers.dev` ✔ | **missing** | Preview read + live |
| Vercel API, scheduler, operator | `BOARD_SHARE_SESSION_SIGNING_KEY` | Secret (Sensitive) | Required | 64 **lowercase** hex | present | **missing** | UNVERIFIED value (Preview create works, so it decodes) |
| Vercel scheduler | `CRON_SECRET` | Secret | Required for the schedule | identical to the same environment's signing key | **missing** | **missing** | Live 401 confirms absence/mismatch |
| Vercel API | `BOARD_SHARE_CLEANUP_ALERT_URL` | Secret | Optional (recommended) | HTTPS webhook | missing | missing | — |
| Vercel API | `BOARD_SHARE_CREATOR_PASSWORD_HASH` | — | **Obsolete** | — | present (Sensitive) | absent ✔ | Unused by code |
| Vercel runtime | `VERCEL` | Platform | Required (implicit) | `1` | platform | platform | Preview create succeeded (would 503 otherwise) |
| Worker | `BOARD_SHARES` | R2 binding | Required | bucket | `my-states-board-sharing-test` ✔ | **Worker missing** | account |
| Worker | `BOARD_SHARE_ALLOWED_ORIGIN` | Plain var | Required | exact origin | Preview alias ✔ | **Worker missing** | account |
| Browser build | `VITE_IMAGE_COLLECTIONS_BASE_URL` | Public config | Conditional | URL root | absent (bundled samples only) | `https://library.endlessmoment.xyz` | Read; CORS allows `www` ✔ |
| Browser build | `VITE_POSTHOG_HOST`, `VITE_POSTHOG_PROJECT_TOKEN` | Public config | Conditional | — | absent | present | not read |
| Browser build | `VITE_POSTHOG_INTERNAL_TESTER`, `VITE_LOCAL_ORIGIN` | Public config | Optional | — | absent | absent | — |
| Operator shell | `BOARD_SHARE_ALLOWED_ORIGIN`, `BOARD_SHARE_SESSION_SIGNING_KEY` | env for `scripts/cleanup-board-shares.mjs` | Incident only | as above | — | — | — |

Cloudflare resources: R2 `my-states-board-sharing-test` (private; CORS GET+PUT from Preview origin; no lifecycle beyond default), R2 `my-states-board-sharing-production` (private, empty; CORS GET+PUT from `www`, exposes ETag; no lifecycle beyond default), account tokens `my-states-board-sharing-test` / `-production` (Item Write on one bucket each), Worker `my-states-board-upload-preview`.

---

## 5. Remaining actions

Order matters where noted. “Codex” = code/config-file changes in the repo; “User” = dashboard/CLI actions with account credentials.

| # | Owner | Action | Acceptance |
|---|---|---|---|
| C1 | Codex | **Written 2026-11-27, not yet committed.** `worker/wrangler.production.jsonc`: name `my-states-board-upload`, `main ./boardShareUpload.mjs`, compatibility date 2026-11-01, `workers_dev: true`, `BOARD_SHARES` → `my-states-board-sharing-production`, `BOARD_SHARE_ALLOWED_ORIGIN = "https://www.my-states.xyz"`. Preview config unchanged. `npx wrangler@4.168.0 deploy --dry-run` (nothing uploaded) listed exactly those two bindings for Production and the unchanged test-bucket bindings for Preview. | Done: the dry run shows it cannot bind the test bucket |
| U1 | User (after C1) | `npx wrangler deploy --config worker/wrangler.production.jsonc`; record version ID and workers.dev URL. Check with `curl -X OPTIONS <url>/upload/<48 zeros> -H "Origin: https://www.my-states.xyz" -H "Access-Control-Request-Method: PUT"` → 204 with exact origin. **Done 2026-11-27T13:27:33Z:** `my-states-board-upload`, version `17c6caa2-5686-418e-aa6c-bfbacb80be2a` (100 %), origin `https://my-states-board-upload.my-states-xyz.workers.dev`. Checked 13:28Z: bindings are `BOARD_SHARES` → `my-states-board-sharing-production` and origin `https://www.my-states.xyz`; deployed source SHA-256 `6aef218a…ffe4` (identical to the reviewed Worker); preflight from `www` 204 with exact origin, `PUT`, `Authorization, Content-Type`; preflight from the Preview origin and from the apex 403; forged token 403. | Done |
| U2 | User | In Vercel Production: set `BOARD_SHARE_UPLOAD_ORIGIN` = U1's URL (no trailing slash); generate a new 32-byte random key as 64 lowercase hex and set it as both `BOARD_SHARE_SESSION_SIGNING_KEY` and `CRON_SECRET` (Sensitive). Do not reuse the Preview key. | **Done 2026-11-27:** signing key 13:34Z and `CRON_SECRET` 13:37Z (Sensitive, Production only, set by the user); `BOARD_SHARE_UPLOAD_ORIGIN` 13:40Z = `https://my-states-board-upload.my-states-xyz.workers.dev` (read back exactly). All eight Production sharing variables present once each. Equality of the two Sensitive values is proved only by the first successful Production cleanup run (§6.1 step 8). |
| U3 | User | In Vercel Preview (branch `experiment/board-sharing`): set `CRON_SECRET` to the Preview signing key (or rotate both to a new identical lowercase-hex value), redeploy the branch, then `vercel schedules invoke board-share-cleanup --git-branch experiment/board-sharing` and `vercel schedules executions list …`. | **Execution succeeds**; `trial/cleanup-state-v1.json` appears in the test bucket; expired test archives disappear over subsequent runs. If it still fails with 401 while the values match, Deployment Protection is blocking the schedule — stop and report. **Done 2026-11-27:** Preview key and `CRON_SECRET` replaced together; redeploy `dpl_bu8oBAq24zrSXoViEe5waNt1zJK3` (`b810fc1`, 13:48Z); manual run `schx_0Z2PVV220J67G1JT79EBX5JV8J` at 13:54Z **succeeded** (4.6 s); `trial/cleanup-state-v1.json` written with `lastSuccessAt` 13:54:17Z and no backlog; three expired test shares marked `expired` and their archives/staging removed. Vercel Deployment Protection does not block Preview schedule runs. Hourly Preview schedule enabled 13:59Z (`active`, no end date). |
| U4 | User | Optional, recommended: create an HTTPS incoming webhook for each environment and set `BOARD_SHARE_CLEANUP_ALERT_URL`; redeploy. | Controlled failure delivers one generic event |
| U5 | User | Remove the obsolete Preview `BOARD_SHARE_CREATOR_PASSWORD_HASH`. | Absent from env list |
| U6 | User | Replace CORS on both sharing buckets with GET only from the exact origin: `[{"AllowedOrigins":["<origin>"],"AllowedMethods":["GET"],"MaxAgeSeconds":600}]` (Preview alias for test, `https://www.my-states.xyz` for Production). | **Done 2026-11-27T14:04Z** via the Cloudflare API (a rule carrying an `id` returned HTTP 500; the rule without one succeeded). Live R2 preflights: `GET` from each bucket's own origin 204; `PUT` 403; `GET` from the other environment's origin 403. A fresh creator → recipient run on Preview `dpl_bu8oBAq2…` at 14:05Z passed (create 201, Worker PUT 200, complete 200, resolve 200, image imported); its objects were deleted at 14:05:36Z. |
| U7 | User | Optional: add a lifecycle rule on each sharing bucket, prefix exactly `staging/`, delete after 2 days. Never on `shares/`, `trial/` or the whole bucket. | **Done 2026-11-27T14:05Z** on both buckets: rule `staging-2-days` (enabled, prefix `staging/`, delete after 172,800 s), alongside the unchanged “Default Multipart Abort Rule”. No rule covers `shares/`, `trial/` or the whole bucket. |
| U8 | User | After U3 succeeds, disable or retire the legacy no-expiry ready record in the **test** bucket (protected `disable` action). Never copy test objects to Production. | Resolve → 410 |
| U9 | User | Merge `experiment/board-sharing` to `main` only after U1–U3 (and U6) are done, so the Production deployment is built after all variables exist. Then enable/confirm the Production schedule in Vercel → Schedules and run §6.1. | §6.1 passes |
| C2 | Codex | Replace `browser-tests/board-share-request-headers.spec.ts` with a test of the Worker upload/OPTIONS contract. | Test fails if the client sends a direct R2 PUT |
| C3 | Codex | Optional hardening: isolate per-record errors in `cleanup()`; add a create-only kill switch (env flag read by `create` only); alert on cleanup 4xx/missed runs (e.g. compare `lastSuccessAt`). | Unit tests |
| U10 | User | Decide ownership: who watches Vercel Schedules executions and the alert webhook daily during the first week, and who may run the manual cleanup script. | Named person |
| U11 | User | Optional pre-release: set PostHog `VITE_*` variables for the Preview branch to observe real PostHog payloads before release; otherwise do it in §6.1 step 7. | — |

Responsible party for every code change: Codex. Nothing in §5 was performed by this review.

---

## 6. Post-release smoke test and rollback

### 6.1 Production smoke test (run immediately after the authorised release)

Use a fresh browser profile/private window for the creator and a **different** browser profile or device for the recipient, at the same desktop viewport. Use one small synthetic board (one local image, one short note, a non-default theme). Never paste the link, token or signed URL into chat, tickets or analytics.

1. Record the Production deployment ID and confirm its Git SHA equals the merged commit; record the Production Worker version ID.
2. `https://my-states.xyz/` → 308 → `https://www.my-states.xyz/`.
3. Creator: Share → Share → stages appear → link appears → Copy link. Link must start `https://www.my-states.xyz/share/`.
4. Recipient: open the link directly; “Continue to board”; image, note, theme, layout match; reload the page (direct `/share/<id>` refresh) still reopens the local copy; edit and reopen; creator unchanged.
5. In the recipient DevTools Network tab: Worker preflight/PUT (creator side) 204/200 with exact origin; R2 GET 200 without CORS errors.
6. Repeat step 3–4 with a board containing one curated library image.
7. In the recipient DevTools, filter for `posthog` and `_vercel/insights`: no request URL, header or body contains the 48-character ID (search for its first 12 characters). Check PostHog “Live events” `$current_url`/`$pathname` show `/share/:id`.
8. Vercel → Schedules: `board-share-cleanup` is active for Production; after the next hour, its execution succeeded. In Cloudflare, `trial/cleanup-state-v1.json` exists in the Production bucket.
9. Unauthenticated `POST https://www.my-states.xyz/api/boardShareCleanup` → 401.
10. Confirm Preview credentials/bucket were not used: Production bucket now contains the new `shares/…` objects; test bucket did not change during the smoke test.

Checks that necessarily remain post-release because the feature is not in Production: steps 1–10. Expiry after 24 h is covered by server-side checks proven on Preview; no 24-hour wait is required.

### 6.1a Smoke test results (2026-11-27, after merging PR #26)

Run 14:39–14:46 UTC by the reviewer, Playwright Chromium 153 headless, 1440×900, a fresh context per creator and per recipient. Two synthetic shares; no ID, token or signed URL recorded here.

| Step | Result | Evidence |
|---|---|---|
| 1 Versions | PASS | PR #26 merged 14:37:59Z as `50d5124f173d5ffb7a51d2bb29157f9ae8ff9d1c` (= `origin/main`). Production deployment `dpl_5trDGrhGbKTQd8sjLTB6qsvzW4xH`, READY, built from `50d5124` at 14:38:03Z, after every Production variable was set. Production Worker version `17c6caa2-5686-418e-aa6c-bfbacb80be2a` (100 %). |
| 2 Redirect | PASS | `https://my-states.xyz/` 308 → `https://www.my-states.xyz/`; `www` 200 with `Referrer-Policy: no-referrer`; `/share/<48 zeros>` serves the app; resolve of an unknown ID → 404 JSON. |
| 3 Creator | PASS (both shares) | Fresh context with no cookies; the first-run welcome dialog was dismissed with “Got it”; stages shown; link starts `https://www.my-states.xyz/share/`; Copy link put exactly the link on the clipboard (“Copied”); wording “Link available for 24 hours, until 28 nov, 15:42 … keep their own copies …”. Requests: create 201 → Worker `PUT` 200 at `my-states-board-upload.my-states-xyz.workers.dev` → complete 200. No downloads, no page errors. |
| 4 Recipient | PASS | Separate fresh context, direct navigation: resolve 200, image imported as a `blob:` (loaded). Share A: note text present, pinned theme “Minimal” preserved (visually identical to the default, so this proves the setting carried, not a visual change), recipient rename persisted after reload, creator's board unchanged. Reloading `/share/<id>` reopened the local copy **without** a new resolve. |
| 5 Network/CORS | PASS | Recipient R2 `GET` 200 from bucket `my-states-board-sharing-production`, `Access-Control-Allow-Origin: https://www.my-states.xyz`. No CORS errors. |
| 6 Library image | PASS | Share B: collection chosen from the Images panel; creator image served from `library.endlessmoment.xyz` (all library requests 200, so library CORS for `www` works); recipient image imported as `blob:`. |
| 7 Analytics | PASS | Headless Chromium is filtered out as a bot by both PostHog and Vercel Analytics, so the payload check reopened share A in a context presenting as ordinary Chrome (user agent, brand list and `navigator.webdriver` corrected). 5 analytics requests decoded: PostHog `$pageview` ×2, `$$heatmap`, `$web_vitals` (`eu.i.posthog.com`) and Vercel `/_vercel/insights/view` ×2. `$current_url`, `$pathname`, `$session_entry_url`, `$session_entry_pathname` and Vercel `o` all read `…/share/:id`; after an onward navigation the session-entry properties stay redacted. Neither the full ID nor its first 12 characters appeared in any URL, header or body. This sent a few real test events to Production analytics. |
| 8 Schedule | **FAIL → fix in review** | `board-share-cleanup` created for Production at 14:39:34Z, active, hourly, `POST /api/boardShareCleanup`. First scheduled run `schx_3HSTGKB4CD04WS0Z4JXM26B8RJ` at 15:14:49Z **failed with HTTP 415** (“JSON Content-Type is required”). The key check runs before that point, so **Production `CRON_SECRET` does equal the signing key**. Cause: the route copied the whole incoming request into the cleanup action, and the scheduler's empty body reached the JSON-body check instead of the scheduled-cleanup branch. Preview's runs at 14:14Z and 15:14Z returned 200 on the same code, because its request carried no body at all. Unit tests reproduce it: with the old forwarding, 4 of 5 empty-body request shapes fail, including `Content-Length: 0`, because copying a request drops that header. Fix on branch `fix/scheduled-cleanup-request`: the scheduled route forwards only the method and the `Authorization` header (`api/_lib/scheduledCleanup.ts`). Not yet deployed. Until it is, Production cleanup does not run: expired links are still refused by the server, but their files stay in R2 (staging files are removed after 2 days by the lifecycle rule). |
| 9 Cleanup auth | PASS | Unauthenticated `POST /api/boardShareCleanup` → 401; create from the apex origin → 403. |
| 10 Isolation | PASS | Production bucket: exactly the two smoke shares (status, archive, staging each) and the two usage ledgers. Test bucket: 23 objects, last modified 14:14:54Z (Preview cleanup), untouched during 14:41–14:46Z. |

Smoke-test objects: two Production shares created 14:42–14:43Z remain in `my-states-board-sharing-production`. Nobody else has the links; they expire at 15:42 and 15:43 UTC on 2026-11-28, and hourly cleanup then removes their files. Browser coverage remains Chromium only.

### 6.2 Rollback

- **Trigger:** any of steps 3–9 fails, analytics shows share IDs, or cleanup fails repeatedly.
- **Stop new shares without breaking links:** preferred is a Vercel Firewall custom rule blocking `POST` to `/api/boardShares` where query `action=create` (test it on Preview first; none exists today). Do **not** remove R2 or origin variables — that breaks resolve and cleanup too.
- **Code rollback:** Vercel “Instant Rollback” to `dpl_CRW21jCV…` (`d2c5335`) removes `/api/boardShares` and `/api/boardShareCleanup`. Consequences: existing links stop resolving (recipients who already imported keep local copies), and the Production schedule disappears with the deployment. R2 objects remain and upload tokens issued in the last 30 minutes remain valid at the still-deployed Worker (they can only write staging for pending shares).
- **After a code rollback:** keep the Production Worker or delete it (`wrangler delete`) to revoke outstanding upload ability; then either redeploy sharing code to run cleanup, or run `scripts/cleanup-board-shares.mjs` from a protected shell against a deployment that contains the cleanup route; or, if sharing is abandoned, empty the Production sharing bucket deliberately (operator decision; irreversible).
- Rollback never deletes R2 data, revokes past upload tokens at the Worker, or recalls signed GET URLs (≤120 s).

---

## 7. Status of earlier findings (2026-11-26 review)

| Finding | Status now |
|---|---|
| F1 analytics ID disclosure | Fixed in source (unit); live payload UNVERIFIED (§2.11) |
| F2 upload size not enforced | **Fixed and verified live** on the real Worker + R2 test bucket (§2.6) |
| F3 no scheduled cleanup | Code fixed; **configuration missing**, never succeeded (§2.10) |
| F4 unbounded API body | **Fixed and verified live** on Preview (§2.7) |
| F5 theme outlives failed import | Fixed (unit) |
| P1 production settings/provenance | Provenance now verified; Production settings incomplete (§5) |
| P2 real-R2 races | Unit only; unchanged |
| P3 content/browser coverage | Local image, theme, layout, camera, edits, reopen, two tabs verified live in Chromium; curated image, notes, other browsers UNVERIFIED |
| P4 advisories | Earlier high advisories fixed; 29 new moderate/low advisories, not reachable from share import (§1.4) |
