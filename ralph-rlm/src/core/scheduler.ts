import type { Feature, FeatureList } from '../config/types.js';

export function isFeatureReady(feature: Feature, featureMap: Map<string, Feature>): boolean {
  const dependencies = feature.depends_on ?? [];
  return dependencies.every((dependencyId) => featureMap.get(dependencyId)?.status === 'complete');
}

export function selectNextFeature(data: FeatureList): Feature | null {
  const featureMap = new Map(data.features.map(feature => [feature.id, feature]));
  const candidates = data.features.filter((feature) => {
    if (feature.status !== 'pending' && feature.status !== 'in_progress') {
      return false;
    }
    return isFeatureReady(feature, featureMap);
  });

  if (candidates.length === 0) {
    return null;
  }

  const inProgress = candidates
    .filter(feature => feature.status === 'in_progress')
    .sort(compareFeatures);

  if (inProgress.length > 0) {
    return inProgress[0] ?? null;
  }

  return candidates.sort(compareFeatures)[0] ?? null;
}

function compareFeatures(a: Feature, b: Feature): number {
  const byPriority = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER);
  if (byPriority !== 0) return byPriority;

  const byAttempts = a.attempts - b.attempts;
  if (byAttempts !== 0) return byAttempts;

  return a.id.localeCompare(b.id);
}
