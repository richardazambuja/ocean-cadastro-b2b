import {fetchAllLocations} from './api.mjs';
import {fetchReviewSnapshot} from './reprovados-api.mjs';

// Publish one complete snapshot. Partial reads never change commercial labels.
export async function loadPanelData({locations=fetchAllLocations,reviews=fetchReviewSnapshot}={}) {
  const started=Date.now();
  const [items,review]=await Promise.all([locations(),reviews()]);
  return {locations:items,decisions:review.statuses,reviewDecisions:review.decisions,loadedAt:Date.now(),ms:Date.now()-started};
}
