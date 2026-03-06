import type { Feature, FeatureList, FeatureListConfig, FeatureListStats } from '../../src/config/types.js';

export interface FeatureDependency {
  featureId: string;
  dependsOn: string[];
}

export interface FeatureFiles {
  featureId: string;
  relatedFiles: string[];
}

export interface FeatureListOptions {
  pending?: number;
  inProgress?: number;
  complete?: number;
  blocked?: number;
  claimedByPrefix?: string;
  project?: string;
  config?: Partial<FeatureListConfig>;
  dependencies?: FeatureDependency[];
  relatedFiles?: FeatureFiles[];
}

export function createFeature(overrides: Partial<Feature> & { id: string }): Feature {
  return {
    description: `Test feature ${overrides.id}`,
    status: 'pending',
    attempts: 0,
    last_error: null,
    ...overrides,
  };
}

export function createFeatureList(options: FeatureListOptions = {}): FeatureList {
  const {
    pending = 3,
    inProgress = 0,
    complete = 0,
    blocked = 0,
    claimedByPrefix = 'implementer',
    project = 'test-project',
    config: configOverrides,
    dependencies = [],
    relatedFiles: relatedFilesOpt = [],
  } = options;

  const features: Feature[] = [];
  let counter = 1;

  for (let i = 0; i < complete; i++) {
    const id = `F${String(counter).padStart(3, '0')}`;
    features.push(createFeature({
      id,
      description: `Completed feature ${id}`,
      status: 'complete',
      attempts: 1,
    }));
    counter++;
  }

  for (let i = 0; i < inProgress; i++) {
    const id = `F${String(counter).padStart(3, '0')}`;
    features.push(createFeature({
      id,
      description: `In-progress feature ${id}`,
      status: 'in_progress',
      claimed_by: `${claimedByPrefix}-${i + 1}`,
      attempts: 1,
    }));
    counter++;
  }

  for (let i = 0; i < pending; i++) {
    const id = `F${String(counter).padStart(3, '0')}`;
    features.push(createFeature({
      id,
      description: `Pending feature ${id}`,
      status: 'pending',
    }));
    counter++;
  }

  for (let i = 0; i < blocked; i++) {
    const id = `F${String(counter).padStart(3, '0')}`;
    features.push(createFeature({
      id,
      description: `Blocked feature ${id}`,
      status: 'blocked',
      attempts: 5,
      last_error: 'Build failed: CS1002 on attempt 5',
    }));
    counter++;
  }

  // Apply dependencies
  for (const dep of dependencies) {
    const feature = features.find(f => f.id === dep.featureId);
    if (feature) feature.depends_on = dep.dependsOn;
  }

  // Apply related files
  for (const rf of relatedFilesOpt) {
    const feature = features.find(f => f.id === rf.featureId);
    if (feature) feature.related_files = rf.relatedFiles;
  }

  const total = pending + inProgress + complete + blocked;

  const stats: FeatureListStats = {
    total: total,
    complete,
    in_progress: inProgress,
    pending,
    blocked,
  };

  const featureListConfig: FeatureListConfig = {
    max_attempts_per_feature: 5,
    coverage_threshold: 95,
    ...configOverrides,
  };

  return {
    project,
    config: featureListConfig,
    stats,
    features,
  };
}
