/**
 * The version stamped on every moment record this build writes. Kept apart
 * from storage.ts so the architecture report and tests can read it without
 * opening the database.
 *
 * Version 2 (2026-09-13): a moment always has a document from creation;
 * storage builds it directly (see `documentFromDraft` in panelStore.ts).
 * Version 1 moments carried a `draft` instead, built into a document only
 * once the canvas first opened them. That field is gone from the `Moment`
 * type, so a version-1 record is unreadable by this build. That is not a migration: version 1 was this database's
 * first release, so it is discarded like the
 * database before it, not carried forward. `checkMomentSchema` in
 * storage.ts already refuses any schemaVersion it does not recognise with a
 * clear message; nothing further was needed to retire version 1.
 */
export const MOMENT_SCHEMA_VERSION = 2
