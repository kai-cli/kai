/**
 * TranscriptParser.ts — DEPRECATED re-export shim (W13, 2026-06-05)
 *
 * The canonical implementation moved to hooks/lib/transcript-parser.ts to
 * eliminate the two diverged copies (this file used `completionSummary`, the
 * skills/ copy used `voiceCompletion`). Both fields are now unified as
 * `completionSummary`. This shim re-exports the canonical module for one
 * deprecation cycle so existing importers need no changes.
 *
 * New code should import from '../../hooks/lib/transcript-parser' directly.
 */
export * from '../../hooks/lib/transcript-parser';
