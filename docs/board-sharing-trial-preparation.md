# Anonymous board sharing on the experiment branch

This is the operational design for `experiment/board-sharing`. It is not proof that the Preview Worker, Vercel schedule, R2 settings, or production settings have been configured. See [the readiness review](board-sharing-production-readiness.md) for verification and blockers.

## User flow

Anyone can share without an account: **Share → Create link → Copy link**; the card first states that a copy of the board is uploaded and that anyone with the link can open it for 24 hours. The browser exports a fixed board archive, rejects archives over 32 MiB, hashes it, and asks `POST /api/boardShares?action=create` for a pending share. The response contains a random upload token in the API response only; it is never part of the recipient link. The browser sends the archive and token in an `Authorization` header to the bounded upload Worker at `BOARD_SHARE_UPLOAD_ORIGIN`. The Worker reads the pending status from its private R2 binding, verifies the token and deadline, and only stores an exactly sized, create-only staging object after the stream reaches EOF. It rejects an extra byte before R2 can commit. The existing completion API verifies actual size, digest, ZIP structure/content limits, and source ETag, copies to a final key, then conditionally publishes ready. The link appears only after this confirmation.

New shares expire 24 hours after first successful publication by the server clock. A ready retry returns the original publication/expiration time. Public resolve refuses new retrieval at expiration and signs a GET for at most two minutes, ending before the deadline. A transfer already underway can finish. A clean recipient opens `/share/<id>` without authentication, manually handling a file, or leaving the app. Its archive is bounded, checked, imported as an independent local board, and mapped to the share ID in the same IndexedDB transaction. Reopening in that browser opens its edited copy even after the remote link expires. If its local board was deleted, reimport is possible only while the remote share remains available.

The old creator passphrase, dashboard, history and early deletion UI are gone. Protected `disable` and `cleanup` endpoints remain for operations. Legacy ready trial records without `expiresAt` remain readable until explicitly retired; do not silently migrate them or put them in a production bucket. Old pending records cannot complete without the new token. Only newly published records carry the 24-hour guarantee.

## Objects, limits and failure handling

R2 holds `shares/<id>/status.json`, `staging/<id>/<random>`, `shares/<id>/archive.board.zip`, two usage ledgers under `trial/`, and `trial/cleanup-state-v1.json`. IDs are 24 random bytes; upload tokens are independent 32 random bytes and status stores only the token's SHA-256 verifier. Server code chooses all object keys. The Worker can read only the status for its URL ID and write that status's staging key; its R2 binding must point only at the corresponding private bucket. The browser cannot request arbitrary object reads, lists, copies or deletes. Origin/CORS are browser boundaries; the token is the authorization.

Create limits are 4/source/15 minutes, 12/source/day, 100/global/day, 4 pending/source and 20 pending/global until a 30-minute deadline, and 512 MiB of declared active bytes/day. Resolve limits are 60/source and 1,000/global per 15 minutes. Up to five valid-token completion attempts are allowed per pending share. R2 ETag compare-and-swap protects reservations. An IP address pseudonymized with `BOARD_SHARE_SESSION_SIGNING_KEY` is a shared-network signal, not a person or complete abuse defense. Upload size is 32 MiB compressed; server preflight allows at most 50 MiB expanded, 1 MiB/manifest, 1 MiB/note, 10 MiB/notes, 25 MiB/image, 500 notes and 200 images. The Worker is necessary because R2 presigned PUT does not enforce the browser's claimed byte length and Vercel Functions cannot accept a 32 MiB body on the documented default limit.

Completion, cleanup and a concurrent Worker upload are not a transaction. Conditional status updates decide whether a share is ready or expired. A final object is isolated from browser uploads. Validated staging is retained until expiry for ready-final repair and to prevent an old create-only write from recreating that key. Resolve can restore a missing final from a matching staged archive; if both are missing it returns unavailable and an operator can disable the share. Cleanup marks expired before deleting, does not remove a pending final based on a stale scan, and retries failed deletes. A late Worker write rechecks status and deletes its own staging object if publication/expiration advanced. These guarantees have local tests; real R2 race checks remain a release gate.

## Cleanup

`vercel.json` declares an hourly Vercel **Schedule** (not legacy Production-only Cron) calling `POST /api/boardShareCleanup`. Vercel Schedules [support Preview branches and all plans](https://vercel.com/docs/schedules), but project activation must be verified in the Vercel dashboard. The path uses the existing operations-key authorization. Set `CRON_SECRET` to the same 64-lowercase-hex value as `BOARD_SHARE_SESSION_SIGNING_KEY` in each environment; Vercel sends it as a bearer token. Do not expose either value in logs, URLs, client variables, or reports.

Each run processes at most 100 staging keys and 100 share keys. R2 stores durable cursors and `lastSuccessAt`; a failed run leaves the cursor unchanged and the next hourly run retries. Concurrent runs may repeat a page but an ETag condition prevents stale cursor advancement. The schedule response reports `removed`, `backlog` and `lastSuccessAt`; function 5xx status and Vercel Schedules execution history expose failures. `BOARD_SHARE_CLEANUP_ALERT_URL` is an optional HTTPS webhook secret; on a 5xx, the route posts only a generic event and timestamp. Configure it and test delivery before launch. A missed run produces no webhook, so monitor schedule history or the protected last-success state independently and test one missed-run alert. Do not assume Vercel anomaly alerts report a single hourly failure on every plan.

`node scripts/cleanup-board-shares.mjs` remains a protected manual drain for incident recovery. It uses `BOARD_SHARE_ALLOWED_ORIGIN` and `BOARD_SHARE_SESSION_SIGNING_KEY` from the operator's environment; the key must never be in a shell command or URL. R2 should additionally have a `staging/`-only lifecycle rule, with no blanket rule for `shares/` or `trial/`. Lifecycle timing is not the logical expiration mechanism.

## Environment and external setup

| Variable/binding | Type | Preview/test value | Production value after approval |
| --- | --- | --- | --- |
| `BOARD_SHARE_R2_ENDPOINT` | Vercel Config | HTTPS S3 endpoint for test account | HTTPS S3 endpoint for intended production account |
| `BOARD_SHARE_R2_BUCKET` | Vercel Config | `my-states-board-sharing-test`; must be the same bucket as the Worker's `BOARD_SHARES` binding, because the Worker reads the pending status the API writes there | Separate private production bucket, matching the production Worker binding |
| `BOARD_SHARE_R2_ACCESS_KEY_ID` | Vercel Secret | Test bucket-scoped Object Read & Write token ID | Separate production bucket-scoped token ID |
| `BOARD_SHARE_R2_SECRET_ACCESS_KEY` | Vercel Secret | Matching test token secret | Matching production token secret |
| `BOARD_SHARE_ALLOWED_ORIGIN` | Vercel Config + Worker variable | `https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app` | `https://www.my-states.xyz` (observed canonical redirect; recheck at release) |
| `BOARD_SHARE_UPLOAD_ORIGIN` | Vercel Config | HTTPS origin of the test upload Worker, no trailing slash | Separate production Worker origin |
| `BOARD_SHARE_SESSION_SIGNING_KEY` | Vercel Secret | Existing 32 random bytes as 64 lowercase hex | Separate production value; also operations bearer and IP-HMAC key |
| `CRON_SECRET` | Vercel Secret | Same value as Preview signing key | Same value as Production signing key; required by path schedule |
| `BOARD_SHARE_CLEANUP_ALERT_URL` | Vercel Secret | HTTPS operator-managed notification webhook; no board data is sent | Separate production notification webhook; required for failure notification |
| `BOARD_SHARES` | Worker R2 binding | `my-states-board-sharing-test`, as named by the operator; its existence and privacy have not yet been confirmed in Cloudflare (`npx wrangler r2 bucket list`) | Separate private production bucket |
| `BOARD_SHARE_CREATOR_PASSWORD_HASH` | Obsolete | Remove when safe | Do not set |

The tracked `worker/wrangler.preview.jsonc` binds `BOARD_SHARES` to the existing **test** bucket `my-states-board-sharing-test`, the name supplied by the operator. The Worker has one public configuration variable, `BOARD_SHARE_ALLOWED_ORIGIN`, set there to the exact stable Preview origin. It needs **no Worker secret**: R2 access comes from the binding and each upload uses a per-share token issued by the Vercel API. Authenticate Wrangler through an operator-approved Cloudflare session, deploy, and set the resulting exact `workers.dev` HTTPS origin as `BOARD_SHARE_UPLOAD_ORIGIN` on the Vercel Preview branch. Never paste a credential into the config file. Test Worker CORS needs exact Preview origin, method `PUT`, headers `Authorization` and `Content-Type`; R2 browser CORS is needed only for signed GET (`GET` from exact app origin) after this change. Verify the bucket stays private and Vercel's S3 credentials are bucket-scoped. New R2 presigned PUT URLs are no longer issued by this candidate, but old URLs remain usable until their individual 15-minute expiry; staging cleanup handles their late objects.

From the repository root:

```powershell
npx wrangler login
npx wrangler deploy --config worker/wrangler.preview.jsonc
```

Cloudflare documents `wrangler deploy --config` in its [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) and requires a known-length stream for R2 `put`; the Worker uses `FixedLengthStream` as documented in the [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). The binding remains in the tracked config for later deployments.

The separate curated-image feed must permit browser fetches from the app origin for export; its root comes from `VITE_IMAGE_COLLECTIONS_BASE_URL`. This root was not identified in the checkout. Other app-wide variables include `VITE_POSTHOG_HOST`, `VITE_POSTHOG_PROJECT_TOKEN`, `VITE_POSTHOG_INTERNAL_TESTER`, `VITE_LOCAL_ORIGIN`, and `VITE_TLDRAW_LICENSE_KEY`. None of the server secrets may have a `VITE_` prefix. Do not copy Preview objects or legacy trial statuses into Production.

Emergency stop: block only `POST /api/boardShares?action=create` with an edge rule or a create-only code/config switch, leaving resolve and cleanup running. Removing a required R2 variable would also break existing links. Rollback must keep a compatible resolver and cleanup until all published links have expired and objects are removed; rolling back code does not delete R2 data or revoke already issued upload authorization.
