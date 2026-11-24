# Anonymous board sharing on the experiment branch

This document describes the current implementation on `experiment/board-sharing`. Production still tracks `main`. The checkpoint before this iteration was `8a97de28df8268e902406ea216fde00a1bd95583`.

## Verified starting behavior

The user manually verified that a board with a device-loaded image opens in a clean recipient browser, recipient edits leave the source board unchanged, disabling a link blocks a fresh recipient, and previously imported copies retain their edits. The automated manual-archive baseline also covered notes, theme, panel layout, camera, local image bytes, and reload. The anonymous iteration keeps the same archive exporter, server preflight validator, importer, and IndexedDB share mapping. A real curated R2 image round trip has not been verified because the public curated-feed root is unavailable in this checkout.

## Flow and API

Anyone can choose **Share** beside the board picker. The app exports a fixed `.board.zip`, checks its compressed size, hashes it, requests `POST /api/boardShares?action=create`, and PUTs directly to a unique private R2 staging key. Creation returns an unpredictable upload token separate from the recipient ID; only its SHA-256 verifier is stored in status metadata. `POST ...?action=complete&id=<id>` requires that token in a JSON body. Completion checks the pending deadline, actual staged size, digest, bounded ZIP expansion, manifest, and source ETag before a destination-create-only copy. It marks ready using the status ETag. Repeated completion with the same token returns the first publication and expiration timestamps. The browser receives the stable app link only after confirmation.

New ready shares expire **24 hours after first successful publication**, using the server clock. `GET ...?action=resolve&id=<id>` rejects pending, expired, disabled, invalid, and missing shares; responses are `Cache-Control: no-store`. The short GET signature lasts at most two minutes and is reduced to end before the deadline with a five-second signing margin. An already-started transfer can finish. Recipient retrieval remains internal: bounded download, size and SHA-256 check, in-memory import, cross-tab coordination, and a unique local share mapping. An imported local copy opens even after remote expiration; if the local board was deleted, an expired remote link shows **This share has expired.** No file download dialog, picker, or registration is involved. A pending share allows at most five valid-token completion attempts before a new share is needed, preventing repeated expensive ZIP checks.

The old creator sign-in, share history, and early creator deletion controls have been removed from the public UI and API. `POST ...?action=disable` and `POST ...?action=cleanup` remain **operational only**, requiring a server-held bearer key. No public endpoint lists shares or accepts arbitrary object keys. The ordinary create and complete requests require the exact `BOARD_SHARE_ALLOWED_ORIGIN`; resolution is public.

## Limits and capacity

R2 conditional writes to `trial/share-usage-v1.json` reserve each create before issuing a PUT URL. The ledger has a rolling 24-hour window. A Vercel-overwritten `X-Forwarded-For` value is HMAC hashed before storage; requests fail closed if a trustworthy platform address is unavailable. An IP address is a shared network signal, not a person identifier. A second conditional ledger, `trial/resolve-usage-v1.json`, limits public resolution. Limits are:

| Control | Trial default | Practical effect |
| --- | --- | --- |
| Create frequency per source address | 4 per 15 minutes; 12 per rolling 24 hours | A household or other shared connection shares the budget. |
| Global create count | 100 per rolling 24 hours | At most 100 upload URLs issued daily. |
| Global declared archive bytes | 512 MiB per rolling 24 hours | Pending bytes reserve capacity; completed bytes count for the window. |
| Pending concurrency | 4 per source; 20 globally | Abandoned pending slots free after the 30-minute deadline. |
| Resolve frequency | 60 per source; 1,000 globally per 15 minutes | Local copies open without a resolve request. |
| Archive | 32 MiB compressed; 50 MiB expanded | Existing per-note, per-image, count, MIME, and schema limits also apply. |

The browser checks size before create; the server checks declared size at create, actual staged size and bounded decompression at completion; the recipient bounds the download and importer. Signed PUTs require `Content-Type: application/zip` and `If-None-Match: *`; staging keys are unique and cannot overwrite final keys. **A browser cannot set a signed Content-Length header. R2 has not been verified to enforce an exact PUT length for this flow.** A malicious holder of a 15-minute upload URL may place an oversized staging object, which cannot complete but may occupy storage until cleanup or lifecycle removal. The ledger limits issued URLs and declared bytes, not actual staging bytes. This exposure and R2 behavior require live testing and monitoring before broad public rollout. Failed creates can conservatively consume a count reservation for the 24-hour window; pending byte and slot reservations cease at the deadline.

The limits use a single R2 ledger with ETag compare-and-swap. That is suitable for a small trial but is a contention point and not a general abuse-defense system. No browser identifier or client-supplied IP header is trusted. Do not turn on a challenge for every share. If abusive activity appears, add an edge rule for excessive requests, scoped to the sharing API, after observing traffic.

## Storage, expiry, and cleanup

Status is at `shares/<48-hex-id>/status.json`; staging is under `staging/<id>/`; final archives are at `shares/<id>/archive.board.zip`. Status includes its schema version, legacy trial owner marker, server timestamps, pending/ready/expired/disabled state, upload deadline, expected size and SHA-256, keys, upload-token verifier for new shares, and publication/expiration times for new ready shares. The owner marker is retained so existing records remain readable; it is not a creator account. Expiry is checked at resolve even when cleanup has not run.

The bounded, repeatable cleanup action sweeps at most 100 staging and 100 share keys per call. It expires pending uploads after 30 minutes and new ready shares after 24 hours, deletes their staging/final objects, removes orphaned finals and staging objects recreated by still-valid PUT URLs, and retains expired/disabled metadata for 30 days before deletion. A failed delete can be retried; status is changed before object deletion so resolution stays blocked. The existing R2 lifecycle rule must delete only `staging/` objects after one day. Do not apply it to final archives or status records. Vercel Preview cron is unavailable because Vercel cron runs on Production deployments, so this branch uses manual operational cleanup.

Run `node scripts/cleanup-board-shares.mjs` from an operator process with `BOARD_SHARE_ALLOWED_ORIGIN` and `BOARD_SHARE_SESSION_SIGNING_KEY` already present in its environment. The script sends the key as a bearer token, follows cursors for up to 100 pages, and prints only a deletion count. Avoid putting the key in a shell command, URL, log, or report. Repeat the command after failures. It is operational maintenance, not a creator control.

**Compatibility:** Published legacy trial records without `expiresAt` remain readable until already disabled or explicitly retired by an operator; no automatic 24-hour migration is applied. Old pending records cannot complete without the new upload token and expire after their existing 30-minute deadline. Old disabled records remain disabled. Choosing an expiration or migration date for legacy published links requires a separate decision.

## Preview configuration

Keep these server-side values scoped to the experimental branch's Vercel Preview; none may have a `VITE_` prefix:

| Variable | Type | Use |
| --- | --- | --- |
| `BOARD_SHARE_R2_ENDPOINT` | Config | HTTPS R2 S3 endpoint. |
| `BOARD_SHARE_R2_BUCKET` | Config | Private bucket name. |
| `BOARD_SHARE_R2_ACCESS_KEY_ID` | Secret | Bucket-scoped Object Read & Write token ID. |
| `BOARD_SHARE_R2_SECRET_ACCESS_KEY` | Secret | Matching token secret. |
| `BOARD_SHARE_ALLOWED_ORIGIN` | Config | `https://music-images-canvas-git-experiment-74365d-robert-tomas-projects.vercel.app`. |
| `BOARD_SHARE_SESSION_SIGNING_KEY` | Secret | Existing 32 random bytes encoded as 64 hex characters; retained as the operational bearer key and HMAC key for source-address pseudonyms. |
| `BOARD_SHARE_CREATOR_PASSWORD_HASH` | Obsolete | No longer read. It can be removed from this Preview branch after deployment; no automatic deletion or rotation. |

Keep the bucket private. Browser CORS: allowed origin is the exact stable Preview origin; methods `GET` and `PUT`; allowed headers `Content-Type` and `If-None-Match`; no exposed header needed. Server-side HEAD, COPY, LIST, and DELETE do not need browser CORS. Existing configured R2 credentials need not be replaced. Ensure Vercel Deployment Protection lets anonymous visitors reach the branch Preview and API. The same code must not be merged to Production before its settings and capacity policy are reviewed.

## Verification ledger

Local checks for this iteration: the full Vitest suite passed (74 files, 660 tests before the final focused additions); the final focused service/API/archive suite passed (4 files, 19 tests); TypeScript and Vite build passed; eight local browser sharing tests passed with mocked API and R2 responses. The local browser tests cover a passphrase-free entry, stable link after confirmation, internal recipient retrieval, direct route/refresh, cross-tab deduplication, expiry with and without a local copy, and a failed upload. Controlled-clock tests cover 24-hour expiry, short GET URL lifetime, completion retry, reservations, resolution rate, and cleanup retry. The local manual-archive baseline passed again with one device-loaded image, independent recipient editing, and reload.

**Live Preview check on 2026-11-24:** the stable branch URL served the Ready Preview for implementation commit `2e82875f02aa8eb822dd1193b88a34156ec4567e`. Headless Chromium used a clean creator context with no passphrase, loaded a local image, created and completed a share (`create:201`, `complete:200`), then opened and reopened the link in a separate clean recipient context. The image was visible and no browser download event occurred. This exercised actual Preview API, browser-to-R2 PUT, completion, public resolve, R2 GET, and import. It did **not** verify an oversized PUT, all R2 conditional-write race cases, operational deletion/cleanup, 24-hour wall-clock expiry, recipient editing in that live run, or a real curated R2 image. Those remain separate checks; the curated-feed root is still unknown.

Official references: [Cloudflare conditional writes](https://developers.cloudflare.com/r2/api/s3/conditional-operations/), [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Vercel request headers](https://vercel.com/docs/headers/request-headers), and [Vercel Preview environments](https://vercel.com/docs/deployments/environments).
