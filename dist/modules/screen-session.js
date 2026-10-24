export function createScreenRevisionGuard() {
  let latestRevision = 0;
  return {
    accepts(detail = {}) {
      const revision = Math.max(0, Number(detail.assetRevision) || 0);
      if (revision < latestRevision) return false;
      latestRevision = revision;
      return true;
    },
    latest() { return latestRevision; },
    reset() { latestRevision = 0; }
  };
}
