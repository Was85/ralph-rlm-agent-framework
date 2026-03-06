import type { Feature } from '../config/types.js';

export interface ExecutionLevel {
  level: number;
  featureIds: string[];
}

export interface ExecutionPlan {
  levels: ExecutionLevel[];
  hasCycles: boolean;
  cyclicFeatureIds: string[];
}

/**
 * Normalizes a file path for comparison: forward slashes, lowercase.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Checks whether two features have overlapping related_files.
 */
export function hasFileOverlap(a: Feature, b: Feature): boolean {
  if (!a.related_files?.length || !b.related_files?.length) return false;
  const setA = new Set(a.related_files.map(normalizePath));
  return b.related_files.some(f => setA.has(normalizePath(f)));
}

/**
 * Detects cycles in the dependency graph using DFS.
 * Returns the set of feature IDs involved in cycles.
 */
function detectCycles(
  featureIds: Set<string>,
  adjacency: Map<string, string[]>,
): Set<string> {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cyclic = new Set<string>();

  for (const id of featureIds) color.set(id, WHITE);

  function dfs(node: string, path: string[]): boolean {
    color.set(node, GRAY);
    path.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!featureIds.has(neighbor)) continue;
      const c = color.get(neighbor);
      if (c === GRAY) {
        // Found cycle — mark all nodes in the cycle
        const cycleStart = path.indexOf(neighbor);
        for (let i = cycleStart; i < path.length; i++) {
          cyclic.add(path[i]!);
        }
        return true;
      }
      if (c === WHITE) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const id of featureIds) {
    if (color.get(id) === WHITE) {
      dfs(id, []);
    }
  }

  return cyclic;
}

/**
 * Splits features within a level into sub-levels based on file overlap.
 * Features that share related_files cannot be in the same sub-level.
 * Uses greedy graph coloring.
 */
function splitByFileOverlap(features: Feature[]): string[][] {
  if (features.length <= 1) return [features.map(f => f.id)];

  // Build conflict graph
  const conflicts = new Map<string, Set<string>>();
  for (const f of features) conflicts.set(f.id, new Set());

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i]!;
      const b = features[j]!;
      if (hasFileOverlap(a, b)) {
        conflicts.get(a.id)!.add(b.id);
        conflicts.get(b.id)!.add(a.id);
      }
    }
  }

  // Greedy coloring
  const colorOf = new Map<string, number>();
  const subLevels: string[][] = [];

  for (const f of features) {
    const usedColors = new Set<number>();
    for (const neighbor of conflicts.get(f.id)!) {
      const c = colorOf.get(neighbor);
      if (c !== undefined) usedColors.add(c);
    }

    let color = 0;
    while (usedColors.has(color)) color++;

    colorOf.set(f.id, color);
    while (subLevels.length <= color) subLevels.push([]);
    subLevels[color]!.push(f.id);
  }

  return subLevels;
}

/**
 * Builds an execution plan from features using topological sort and file overlap analysis.
 *
 * - Only considers pending/in_progress features
 * - Respects depends_on edges
 * - Detects cycles (cyclic features are excluded)
 * - Splits levels by related_files overlap
 * - If no depends_on/related_files metadata: all features in level 0 (sequential)
 */
export function buildExecutionPlan(features: Feature[]): ExecutionPlan {
  // Filter to actionable features
  const actionable = features.filter(
    f => f.status === 'pending' || f.status === 'in_progress',
  );

  if (actionable.length === 0) {
    return { levels: [], hasCycles: false, cyclicFeatureIds: [] };
  }

  const featureMap = new Map(actionable.map(f => [f.id, f]));
  const featureIds = new Set(actionable.map(f => f.id));

  // Build adjacency: feature → features it depends on (edges point to dependencies)
  const dependsOn = new Map<string, string[]>();
  for (const f of actionable) {
    const deps = (f.depends_on ?? []).filter(d => featureIds.has(d));
    dependsOn.set(f.id, deps);
  }

  // Detect cycles
  const cyclicIds = detectCycles(featureIds, dependsOn);
  const hasCycles = cyclicIds.size > 0;

  // Remove cyclic features from processing
  const validIds = new Set([...featureIds].filter(id => !cyclicIds.has(id)));

  if (validIds.size === 0) {
    return {
      levels: [],
      hasCycles,
      cyclicFeatureIds: [...cyclicIds],
    };
  }

  // Compute in-degrees for topological sort
  const inDegree = new Map<string, number>();
  for (const id of validIds) inDegree.set(id, 0);

  for (const id of validIds) {
    for (const dep of dependsOn.get(id) ?? []) {
      if (validIds.has(dep)) {
        // dep → id means id depends on dep, so we count edges dep→id in reverse
        // Actually: id depends on dep, so dep must come first.
        // In-degree of id increases for each valid dependency.
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }

  // BFS-based topological sort into levels
  const topoLevels: string[][] = [];
  const remaining = new Set(validIds);

  while (remaining.size > 0) {
    // Find all nodes with in-degree 0
    const ready: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        ready.push(id);
      }
    }

    if (ready.length === 0) {
      // This shouldn't happen after cycle removal, but safety net
      break;
    }

    ready.sort(); // deterministic ordering
    topoLevels.push(ready);

    for (const id of ready) {
      remaining.delete(id);
    }

    // Decrease in-degree for dependents
    for (const id of remaining) {
      const deps = dependsOn.get(id) ?? [];
      let newDegree = 0;
      for (const dep of deps) {
        if (remaining.has(dep)) newDegree++;
      }
      inDegree.set(id, newDegree);
    }
  }

  // Split each topological level by file overlap
  const finalLevels: ExecutionLevel[] = [];
  let levelCounter = 0;

  for (const topoLevel of topoLevels) {
    const levelFeatures = topoLevel
      .map(id => featureMap.get(id)!)
      .filter(Boolean);

    const subLevels = splitByFileOverlap(levelFeatures);
    for (const subLevel of subLevels) {
      subLevel.sort(); // deterministic
      finalLevels.push({
        level: levelCounter++,
        featureIds: subLevel,
      });
    }
  }

  return {
    levels: finalLevels,
    hasCycles,
    cyclicFeatureIds: [...cyclicIds],
  };
}
