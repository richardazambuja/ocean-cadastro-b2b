export const READ = `query OceanReadBridge($id: ID!) {
  companyLocation(id: $id) {
    id
    review: metafield(namespace: "ocean_b2b", key: "review") { type value compareDigest }
    ready: metafield(namespace: "ocean_b2b", key: "ready") { type value }
    status: metafield(namespace: "ocean_b2b", key: "status") { type value }
    cycle: metafield(namespace: "ocean_b2b", key: "cycle_id") { type value }
    entered: metafield(namespace: "ocean_b2b", key: "pending_since") { type value }
    ledger: metafield(namespace: "ocean_b2b", key: "notifications") { type value compareDigest }
    signal: metafield(namespace: "ocean_b2b", key: "signal") { type value compareDigest }
  }
}`;

export const SET = `mutation OceanSetBridge($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value compareDigest }
    userErrors { field message code }
  }
}`;

export const SIGNAL = `mutation OceanSignalCycle($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id handle type updatedAt fields { key value } }
    userErrors { field message code }
  }
}`;

export const READ_SIGNAL = `query OceanReadSignal($handle: MetaobjectHandleInput!) {
  metaobjectByHandle(handle:$handle) { id handle type updatedAt fields { key value } }
}`;

export const REVIEW = `query OceanReadCommercialDecision($handle: MetaobjectHandleInput!) {
  metaobjectByHandle(handle: $handle) { id handle updatedAt fields { key value } }
}`;
