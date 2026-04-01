import type { Feature, FeatureList } from '../config/types.js';

export interface FeatureQualityIssue {
  featureId?: string;
  message: string;
}

export interface FeatureQualityNormalization {
  featureId: string;
  changes: string[];
}

const UI_FILE_PATTERN = /\.(?:tsx|jsx|vue|svelte|html|css|scss|sass|less|razor|cshtml)$/i;
const UI_KEYWORD_PATTERNS = [
  /\bui\b/i,
  /\bfrontend\b/i,
  /\bpage\b/i,
  /\bscreen\b/i,
  /\bcomponent\b/i,
  /\bmodal\b/i,
  /\bform\b/i,
  /\bbutton\b/i,
  /\bview\b/i,
];
const E2E_PATTERNS = [
  /\bplaywright\b/i,
  /\bcypress\b/i,
  /\be2e\b/i,
  /\bend-to-end\b/i,
  /\bbrowser\b/i,
];
const INTEGRATION_TEST_PATTERNS = [
  /\bintegration test/i,
  /\bintegration tests/i,
  /\bsupertest\b/i,
  /\bapi test/i,
  /\bendpoint test/i,
  /\brequest test/i,
];
const UNIT_TEST_PATTERNS = [
  /\bunit test/i,
  /\bjest\b/i,
  /\bvitest\b/i,
  /\bmocha\b/i,
  /\bpytest\b/i,
  /\bxunit\b/i,
  /\bnunit\b/i,
  /\bjunit\b/i,
];
const TEST_FILE_PATTERN = /(?:^|[\\/])(?:test|tests|spec|specs|e2e|playwright|cypress)(?:[\\/]|$)|\.(?:test|spec)\./i;
const DOCS_OR_CONFIG_FILE_PATTERN = /\.(?:md|mdx|json|ya?ml|toml|ini|cfg|config|editorconfig)$/i;
const BOOTSTRAP_FEATURE_PATTERN = /\b(bootstrap|scaffold|setup|initialize|foundation)\b/i;
const BROAD_DESCRIPTION_PATTERNS = [
  /\b(?:implement|build|create|add)\s+(?:full|complete)\b/i,
  /\ball\s+(?:crud|endpoints|routes|controllers|pages|screens|components|tests)\b/i,
  /\bmultiple\s+(?:endpoints|routes|pages|screens|components)\b/i,
];

export function normalizeFeatureListQuality(data: FeatureList): FeatureQualityNormalization[] {
  const normalizations: FeatureQualityNormalization[] = [];

  for (const [index, feature] of data.features.entries()) {
    const changes: string[] = [];
    feature.acceptance_criteria = normalizeList(feature.acceptance_criteria);
    feature.verification_steps = normalizeList(feature.verification_steps);
    feature.related_files = normalizeList(feature.related_files);
    feature.depends_on = normalizeList(feature.depends_on);

    if (!Number.isInteger(feature.priority) || (feature.priority ?? 0) < 1) {
      feature.priority = index + 1;
      changes.push(`assigned priority ${feature.priority}`);
    }

    const buildCommand = data.config.build_command?.trim();
    if (buildCommand) {
      const buildCriterion = `Build passes (${buildCommand})`;
      if (!mentionsCommand(feature.acceptance_criteria, buildCommand)) {
        feature.acceptance_criteria.push(buildCriterion);
        changes.push(`added acceptance criterion "${buildCriterion}"`);
      }
      if (!mentionsCommand(feature.verification_steps, buildCommand)) {
        feature.verification_steps.push(buildCommand);
        changes.push(`added verification step "${buildCommand}"`);
      }
    }

    const testCommand = data.config.test_command?.trim();
    if (testCommand) {
      const hasUiSurface = isUiFeature(feature, feature.related_files);
      const testCriterion = hasUiSurface
        ? `Playwright E2E tests pass (${testCommand})`
        : `Unit tests pass (${testCommand})`;

      if (!mentionsCommand(feature.acceptance_criteria, testCommand)) {
        feature.acceptance_criteria.push(testCriterion);
        changes.push(`added acceptance criterion "${testCriterion}"`);
      }
      if (!mentionsCommand(feature.verification_steps, testCommand)) {
        feature.verification_steps.push(testCommand);
        changes.push(`added verification step "${testCommand}"`);
      }
    }

    if (isBootstrapFeature(feature, feature.related_files)) {
      if (feature.related_files.some(file => normalizePath(file) === 'package.json')
        && !feature.related_files.some(file => normalizePath(file) === '.gitignore')) {
        feature.related_files.push('.gitignore');
        changes.push('added bootstrap support file ".gitignore"');
      }

      if (hasTypeScriptConfig(feature.related_files) && !feature.related_files.some(isRuntimeSourceFile)) {
        feature.related_files.push('src/index.ts');
        changes.push('added bootstrap entry file "src/index.ts"');
      }
    }

    const inferredTestFile = inferTestFile(feature.related_files, isUiFeature(feature, feature.related_files));
    if (inferredTestFile && !feature.related_files.some(file => TEST_FILE_PATTERN.test(file))) {
      feature.related_files.push(inferredTestFile);
      changes.push(`added inferred test file "${inferredTestFile}"`);
    }

    const maxRelatedFiles = getMaxRelatedFiles(feature, feature.related_files);
    const trimmedFiles = trimRelatedFiles(feature.related_files, maxRelatedFiles);
    if (trimmedFiles.removed.length > 0) {
      feature.related_files = trimmedFiles.files;
      changes.push(`trimmed related_files to ${maxRelatedFiles} entries by removing: ${trimmedFiles.removed.join(', ')}`);
    }

    if (changes.length > 0) {
      normalizations.push({ featureId: feature.id, changes });
    }
  }

  return normalizations;
}

export function validateFeatureListQuality(data: FeatureList): FeatureQualityIssue[] {
  const issues: FeatureQualityIssue[] = [];
  const idSet = new Set<string>();
  const featureById = new Map<string, Feature>();

  if (!data.project?.trim()) {
    issues.push({ message: 'Project name is required.' });
  }

  if (!Number.isInteger(data.config.max_attempts_per_feature) || data.config.max_attempts_per_feature < 1) {
    issues.push({ message: 'config.max_attempts_per_feature must be a positive integer.' });
  }

  if (data.features.length === 0) {
    issues.push({ message: 'feature_list.json must contain at least one feature.' });
  }

  for (const feature of data.features) {
    if (idSet.has(feature.id)) {
      issues.push({ featureId: feature.id, message: `Duplicate feature id "${feature.id}".` });
      continue;
    }

    idSet.add(feature.id);
    featureById.set(feature.id, feature);
  }

  validateStats(data, issues);

  for (const feature of data.features) {
    validateFeature(feature, data, issues);
  }

  validateDependencies(data.features, featureById, issues);

  return issues;
}

export function formatFeatureQualityIssues(issues: FeatureQualityIssue[], maxIssues: number = 8): string[] {
  const visibleIssues = issues.slice(0, maxIssues);
  const lines = visibleIssues.map(issue => issue.featureId
    ? `${issue.featureId}: ${issue.message}`
    : issue.message,
  );

  if (issues.length > maxIssues) {
    lines.push(`...and ${issues.length - maxIssues} more issue(s).`);
  }

  return lines;
}

function validateStats(data: FeatureList, issues: FeatureQualityIssue[]): void {
  const counts = { complete: 0, in_progress: 0, pending: 0, blocked: 0 };

  for (const feature of data.features) {
    counts[feature.status]++;
  }

  if (data.stats.complete !== counts.complete
    || data.stats.in_progress !== counts.in_progress
    || data.stats.pending !== counts.pending
    || data.stats.blocked !== counts.blocked) {
    issues.push({ message: 'Stats block does not match the actual feature statuses.' });
  }

  if (typeof data.stats.total === 'number' && data.stats.total !== data.features.length) {
    issues.push({ message: 'stats.total must equal the number of features.' });
  }

  if (typeof data.stats.total_features === 'number' && data.stats.total_features !== data.features.length) {
    issues.push({ message: 'stats.total_features must equal the number of features.' });
  }
}

function validateFeature(feature: Feature, data: FeatureList, issues: FeatureQualityIssue[]): void {
  if (!feature.description?.trim()) {
    issues.push({ featureId: feature.id, message: 'Description is required.' });
  }

  if (!Number.isInteger(feature.priority) || (feature.priority ?? 0) < 1) {
    issues.push({ featureId: feature.id, message: 'Priority is required and must be a positive integer.' });
  }

  const acceptanceCriteria = normalizeList(feature.acceptance_criteria);
  const verificationSteps = normalizeList(feature.verification_steps);
  const relatedFiles = normalizeList(feature.related_files);
  const dependsOn = normalizeList(feature.depends_on);
  const minCriteria = data.config.build_command || data.config.test_command ? 3 : 2;

  if (acceptanceCriteria.length < minCriteria) {
    issues.push({
      featureId: feature.id,
      message: `Acceptance criteria are too thin. Expected at least ${minCriteria} explicit criteria.`,
    });
  }

  if (acceptanceCriteria.length > 10) {
    issues.push({ featureId: feature.id, message: 'Acceptance criteria are too broad. Split the feature or trim the criteria list.' });
  }

  if (verificationSteps.length < 2) {
    issues.push({ featureId: feature.id, message: 'Verification steps must include the concrete commands used to prove the feature.' });
  }

  if (!feature.source_requirement?.trim()) {
    issues.push({ featureId: feature.id, message: 'source_requirement is required for PRD traceability.' });
  }

  if (!Array.isArray(feature.depends_on)) {
    issues.push({ featureId: feature.id, message: 'depends_on must be present, even if it is an empty array.' });
  }

  if (new Set(dependsOn).size !== dependsOn.length) {
    issues.push({ featureId: feature.id, message: 'depends_on contains duplicate feature ids.' });
  }

  if (dependsOn.includes(feature.id)) {
    issues.push({ featureId: feature.id, message: 'A feature cannot depend on itself.' });
  }

  if (!Array.isArray(feature.related_files)) {
    issues.push({ featureId: feature.id, message: 'related_files must be present, even if it only contains the implementation and test files.' });
  }

  if (relatedFiles.length < 1) {
    issues.push({ featureId: feature.id, message: 'related_files must identify the files the feature will touch.' });
  }

  const maxRelatedFiles = getMaxRelatedFiles(feature, relatedFiles);
  if (relatedFiles.length > maxRelatedFiles) {
    issues.push({
      featureId: feature.id,
      message: `Feature is too large for one iteration. related_files must stay at 1-${maxRelatedFiles} files.`,
    });
  }

  if (new Set(relatedFiles.map(file => file.toLowerCase())).size !== relatedFiles.length) {
    issues.push({ featureId: feature.id, message: 'related_files contains duplicate entries.' });
  }

  for (const relatedFile of relatedFiles) {
    if (!isSafeRelativePath(relatedFile)) {
      issues.push({ featureId: feature.id, message: `related_files entry "${relatedFile}" must be a safe relative path.` });
    }
  }

  if (BROAD_DESCRIPTION_PATTERNS.some(pattern => pattern.test(feature.description))) {
    issues.push({ featureId: feature.id, message: 'Description is too broad. Split the feature into smaller stories.' });
  }

  enforceCommandCoverage(feature, data, acceptanceCriteria, verificationSteps, issues);
  enforceTestCoverage(feature, relatedFiles, acceptanceCriteria, verificationSteps, issues);
}

function validateDependencies(
  features: Feature[],
  featureById: Map<string, Feature>,
  issues: FeatureQualityIssue[],
): void {
  for (const feature of features) {
    const dependsOn = normalizeList(feature.depends_on);
    for (const dependencyId of dependsOn) {
      const dependency = featureById.get(dependencyId);
      if (!dependency) {
        issues.push({ featureId: feature.id, message: `depends_on references missing feature "${dependencyId}".` });
        continue;
      }

      if ((dependency.priority ?? Number.MAX_SAFE_INTEGER) >= (feature.priority ?? Number.MAX_SAFE_INTEGER)) {
        issues.push({
          featureId: feature.id,
          message: `Dependency "${dependencyId}" must have a lower priority number than "${feature.id}".`,
        });
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (featureId: string): void => {
    const state = visitState.get(featureId);
    if (state === 'done') {
      return;
    }
    if (state === 'visiting') {
      const cycleStart = stack.indexOf(featureId);
      const cyclePath = [...stack.slice(cycleStart), featureId].join(' -> ');
      issues.push({ message: `Dependency cycle detected: ${cyclePath}.` });
      return;
    }

    visitState.set(featureId, 'visiting');
    stack.push(featureId);

    const feature = featureById.get(featureId);
    if (feature) {
      for (const dependencyId of normalizeList(feature.depends_on)) {
        if (featureById.has(dependencyId)) {
          visit(dependencyId);
        }
      }
    }

    stack.pop();
    visitState.set(featureId, 'done');
  };

  for (const feature of features) {
    visit(feature.id);
  }
}

function enforceCommandCoverage(
  feature: Feature,
  data: FeatureList,
  acceptanceCriteria: string[],
  verificationSteps: string[],
  issues: FeatureQualityIssue[],
): void {
  const buildCommand = data.config.build_command?.trim();
  if (buildCommand) {
    if (!mentionsCommand(verificationSteps, buildCommand)) {
      issues.push({ featureId: feature.id, message: `verification_steps must include the build command "${buildCommand}".` });
    }
    if (!mentionsCommand(acceptanceCriteria, buildCommand)) {
      issues.push({ featureId: feature.id, message: `acceptance_criteria must prove the build passes with "${buildCommand}".` });
    }
  }

  const testCommand = data.config.test_command?.trim();
  if (testCommand) {
    if (!mentionsCommand(verificationSteps, testCommand)) {
      issues.push({ featureId: feature.id, message: `verification_steps must include the test command "${testCommand}".` });
    }
    if (!mentionsCommand(acceptanceCriteria, testCommand)) {
      issues.push({ featureId: feature.id, message: `acceptance_criteria must prove the tests pass with "${testCommand}".` });
    }
  }
}

function enforceTestCoverage(
  feature: Feature,
  relatedFiles: string[],
  acceptanceCriteria: string[],
  verificationSteps: string[],
  issues: FeatureQualityIssue[],
): void {
  if (relatedFiles.length === 0) {
    return;
  }

  const textItems = [...acceptanceCriteria, ...verificationSteps];
  const hasUiSurface = isUiFeature(feature, relatedFiles);
  const docsOrConfigOnly = relatedFiles.every(file => DOCS_OR_CONFIG_FILE_PATTERN.test(file));
  const hasTestFile = relatedFiles.some(file => TEST_FILE_PATTERN.test(file));

  if (docsOrConfigOnly) {
    return;
  }

  if (!hasTestFile) {
    issues.push({ featureId: feature.id, message: 'related_files must include at least one test file for the story.' });
  }

  if (hasUiSurface) {
    if (!mentionsPattern(textItems, E2E_PATTERNS)) {
      issues.push({ featureId: feature.id, message: 'UI features must include Playwright or E2E verification criteria.' });
    }
    return;
  }

  if (!mentionsPattern(textItems, [...UNIT_TEST_PATTERNS, ...INTEGRATION_TEST_PATTERNS])) {
    issues.push({ featureId: feature.id, message: 'Non-UI features must include unit-test or integration-test verification criteria.' });
  }
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.isArray(values)
    ? values.map(value => value.trim()).filter(Boolean)
    : [];
}

function mentionsCommand(items: string[], command: string): boolean {
  const normalizedCommand = normalizeCommand(command);
  return items.some(item => normalizeCommand(item).includes(normalizedCommand));
}

function mentionsPattern(items: string[], patterns: RegExp[]): boolean {
  return items.some(item => patterns.some(pattern => pattern.test(item)));
}

function isUiFeature(feature: Feature, relatedFiles: string[]): boolean {
  return relatedFiles.some(file => UI_FILE_PATTERN.test(file))
    || UI_KEYWORD_PATTERNS.some(pattern => pattern.test(feature.description));
}

function isBootstrapFeature(feature: Feature, relatedFiles: string[]): boolean {
  if (BOOTSTRAP_FEATURE_PATTERN.test(feature.description)) {
    return true;
  }

  return relatedFiles.some(file => {
    const normalized = normalizePath(file);
    return normalized === 'package.json'
      || normalized === 'tsconfig.json'
      || normalized === 'tsconfig.base.json'
      || normalized === 'tsconfig.build.json';
  });
}

function getMaxRelatedFiles(feature: Feature, relatedFiles: string[]): number {
  return isBootstrapFeature(feature, relatedFiles) ? 6 : 4;
}

function inferTestFile(relatedFiles: string[], isUi: boolean): string | null {
  for (const relatedFile of relatedFiles) {
    if (TEST_FILE_PATTERN.test(relatedFile) || DOCS_OR_CONFIG_FILE_PATTERN.test(relatedFile)) {
      continue;
    }

    const normalized = relatedFile.replace(/\\/g, '/');
    const sourceMatch = normalized.match(/^src\/(.+)\.(ts|tsx|js|jsx|cs|py|go|java)$/i)
      ?? normalized.match(/^(.+)\.(ts|tsx|js|jsx|cs|py|go|java)$/i);
    if (sourceMatch) {
      const [, stem, extension] = sourceMatch;
      return isUi
        ? `tests/e2e/${stem}.spec.${extension}`
        : `tests/${stem}.test.${extension}`;
    }
  }

  return null;
}

function trimRelatedFiles(relatedFiles: string[], maxFiles: number): { files: string[]; removed: string[] } {
  if (relatedFiles.length <= maxFiles) {
    return { files: relatedFiles, removed: [] };
  }

  const scored = relatedFiles.map((file, index) => ({
    file,
    index,
    score: scoreRelatedFile(file),
  }));

  const keep = [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxFiles);
  const keepSet = new Set(keep.map(item => item.file));
  const files = relatedFiles.filter(file => keepSet.has(file));
  const removed = relatedFiles.filter(file => !keepSet.has(file));

  return { files, removed };
}

function scoreRelatedFile(file: string): number {
  if (TEST_FILE_PATTERN.test(file)) return 100;
  if (isRuntimeSourceFile(file)) return 90;
  if (/\bpackage\.json$/i.test(file)) return 85;
  if (/^\.gitignore$/i.test(file)) return 82;
  if (/^tsconfig(?:\.[^.]+)?\.json$/i.test(file)) return 80;
  if (DOCS_OR_CONFIG_FILE_PATTERN.test(file)) return 40;
  return 50;
}

function normalizeCommand(value: string): string {
  return value.toLowerCase().replace(/[`"'()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSafeRelativePath(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    return false;
  }

  const segments = value.split(/[\\/]+/);
  if (segments.some(segment => segment === '..' || segment === '')) {
    return false;
  }

  return true;
}

function hasTypeScriptConfig(relatedFiles: string[]): boolean {
  return relatedFiles.some(file => /^tsconfig(?:\.[^.]+)?\.json$/i.test(normalizePath(file)));
}

function isRuntimeSourceFile(file: string): boolean {
  return /^src\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(normalizePath(file));
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').trim();
}
