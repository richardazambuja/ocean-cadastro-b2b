import {locationId, project} from './state.mjs';

// For a future native Company location created / Company contact created workflow.
// No writes, no emails, no inference from an unapproved migration or historical data.
export function bootstrapNative({location, existing = null, cutover, rolloutVerified = false, now, uuid, classify}) {
  locationId(location?.id);
  const cutoff = Date.parse(cutover);
  const created = Date.parse(location.createdAt);
  const at = typeof now === 'number' ? now : Date.parse(now);
  if (!rolloutVerified || !Number.isFinite(cutoff) || !Number.isFinite(created) || !Number.isFinite(at) || created < cutoff || created > at) return {skipped: true, reason: 'migration_or_time_unverified'};
  if (existing && (!existing.ready || existing.operationId)) return {skipped: true, reason: 'updating_or_invalid'};
  // A commercial decision must be read only by its owner, or mirrored by that app.
  // Never manufacture a null decision for historical/reopened/approved locations.
  if (existing && (existing.locationId !== location.id || existing.schema !== 1 || existing.decisionVersion || !['pendente', 'incompleto'].includes(existing.status))) return {skipped: true, reason: 'commercial_decision_requires_owner'};
  const state = project({
    location, previous: existing, classify, now, uuid, origin: 'native',
    decision: {verified: true, localId: location.id, status: null, updatedAt: null},
  });
  return {skipped: false, state, expectedCompareDigest: existing ? 'must_use_digest_read_with_existing' : null};
}
