import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  prepareFeatureHarness,
  readContractReview,
  readFeatureContract,
  readImplementationReport,
  readVerificationReport,
} from './feature-harness.js';
import { gitExec } from './safe-exec.js';
import type { Feature, RalphConfig, Runner } from '../config/types.js';

export interface FeatureHarnessResult {
  outcome: 'approved' | 'retry' | 'blocked';
  summary: string;
}

interface PhaseBudget {
  maxTurns: number;
  timeoutMs: number;
}

interface PhaseRunOptions<TArtifact> {
  runner: Runner;
  config: RalphConfig;
  cwd: string;
  prompt: string;
  readArtifact: () => Promise<TArtifact | null>;
  artifactPaths: string[];
  budget: PhaseBudget;
  recoveryBudget?: PhaseBudget;
}

const PLANNER_MAX_TURNS = 8;
const PLANNER_TIMEOUT_MS = 5 * 60 * 1000;
const CONTRACT_REVIEW_MAX_TURNS = 6;
const CONTRACT_REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
const IMPLEMENTER_MAX_TURNS = 20;
const IMPLEMENTER_TIMEOUT_MS = 20 * 60 * 1000;
const VERIFIER_MAX_TURNS = 8;
const VERIFIER_TIMEOUT_MS = 10 * 60 * 1000;

const DEFAULT_ALLOWED_EXTRA_FILES = new Set([
  '.gitignore',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
]);

const BOOTSTRAP_ALLOWED_EXTRA_FILES = new Set([
  'src/index.ts',
  'src/index.js',
  'src/main.ts',
  'src/main.js',
  'src/server.ts',
  'src/server.js',
  'src/app.ts',
  'src/app.js',
]);

const EPHEMERAL_OUTPUT_PREFIXES = [
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.turbo/',
  '.cache/',
  '.tmp/',
  'tmp/',
  'out/',
];

const EPHEMERAL_OUTPUT_SUFFIXES = [
  '.tsbuildinfo',
];

const BOOTSTRAP_FEATURE_PATTERN = /\b(bootstrap|scaffold|setup|initialize|foundation)\b/i;
const ACCEPTANCE_MATCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'then',
  'this',
  'to',
  'when',
  'with',
]);

interface RunHarnessOptions {
  runner: Runner;
  config: RalphConfig;
  promptsDir: string;
  cwd: string;
  feature: Feature;
}

export async function runFeatureHarness(options: RunHarnessOptions): Promise<FeatureHarnessResult> {
  const { runner, config, promptsDir, cwd, feature } = options;
  const paths = await prepareFeatureHarness(cwd, feature);

  const plannerPromptPath = resolvePromptPath(cwd, promptsDir, 'feature-planner.md');
  const evaluatorPromptPath = resolvePromptPath(cwd, promptsDir, 'evaluator.md');
  const implementerPromptPath = resolvePromptPath(cwd, promptsDir, 'implementer.md');
  const plannerBudget = getPlannerBudget(feature);
  const contractReviewBudget = getContractReviewBudget(feature);
  const verifierBudget = getVerifierBudget(feature);

  const contract = await runRetryablePhase({
    runner,
    config,
    cwd,
    prompt: buildPlannerLaunchPrompt(plannerPromptPath, paths.assignmentPath, paths.contractPath),
    readArtifact: () => readFeatureContract(paths.contractPath),
    artifactPaths: [paths.contractPath],
    budget: plannerBudget,
    recoveryBudget: boostBudget(plannerBudget, 4, 2 * 60 * 1000),
  });
  if (!contract) {
    return { outcome: 'retry', summary: 'Planner did not write a valid contract.json artifact' };
  }

  const contractReview = await runRetryablePhase({
    runner,
    config,
    cwd,
    prompt: buildContractReviewPrompt(evaluatorPromptPath, paths.assignmentPath, paths.contractPath, paths.contractReviewPath),
    readArtifact: () => readContractReview(paths.contractReviewPath),
    artifactPaths: [paths.contractReviewPath],
    budget: contractReviewBudget,
    recoveryBudget: boostBudget(contractReviewBudget, 4, 2 * 60 * 1000),
  });
  if (!contractReview) {
    return { outcome: 'retry', summary: 'Evaluator did not write a valid contract-review.json artifact' };
  }

  if (contractReview.outcome !== 'approved') {
    return { outcome: contractReview.outcome, summary: contractReview.summary };
  }

  const headBefore = await getCurrentCommit(cwd);

  await runner.invoke(buildImplementerLaunchPrompt(implementerPromptPath, paths.assignmentPath, paths.contractPath, paths.implementationReportPath), {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
    settingSources: 'project,local',
    cwd,
    maxTurns: IMPLEMENTER_MAX_TURNS,
    timeout: IMPLEMENTER_TIMEOUT_MS,
  });

  const implementationReport = await readImplementationReport(paths.implementationReportPath);
  if (!implementationReport) {
    return { outcome: 'retry', summary: 'Implementer did not write a valid implementation-report.json artifact' };
  }

  if (implementationReport.outcome !== 'ready_for_review') {
    return { outcome: implementationReport.outcome, summary: implementationReport.summary };
  }

  const headAfter = await getCurrentCommit(cwd);
  if (headBefore === headAfter) {
    return { outcome: 'retry', summary: 'Implementer reported success without creating a commit' };
  }

  const commitCount = await getCommitCountSince(cwd, headBefore);
  if (commitCount !== 1) {
    return {
      outcome: 'retry',
      summary: `Implementer created ${commitCount} commits for ${feature.id}; exactly 1 feature commit is required`,
    };
  }

  const dirtyFiles = await getDirtyFiles(cwd);
  await cleanupEphemeralDirtyFiles(cwd, dirtyFiles);
  const dirtyFilesAfterCleanup = await getDirtyFiles(cwd);
  const disallowedDirtyFiles = dirtyFilesAfterCleanup.filter(file => !isAllowedManagedFile(file, feature.id));
  if (disallowedDirtyFiles.length > 0) {
    return {
      outcome: 'retry',
      summary: `Implementer left non-managed changes after completion: ${disallowedDirtyFiles.slice(0, 5).join(', ')}`,
    };
  }

  const changedFiles = await getChangedFilesSince(cwd, headBefore);
  const disallowedChangedFiles = changedFiles.filter(file => !isAllowedFeatureFile(file, feature.id, contract, feature));
  if (disallowedChangedFiles.length > 0) {
    return {
      outcome: 'retry',
      summary: `Implementation drifted outside approved scope: ${disallowedChangedFiles.slice(0, 5).join(', ')}`,
    };
  }

  const latestCommitSubject = await getCurrentCommitSubject(cwd);
  const requiredCommitSubject = getCommitSubject(contract.commit_message);
  if (latestCommitSubject !== requiredCommitSubject) {
    return {
      outcome: 'retry',
      summary: `Implementer used commit subject "${latestCommitSubject}" but contract requires "${requiredCommitSubject}"`,
    };
  }

  const commitShaMatchesHead = await commitRefMatchesHead(cwd, implementationReport.commit_sha, headAfter);
  if (!commitShaMatchesHead) {
    return {
      outcome: 'retry',
      summary: `Implementation report commit SHA ${implementationReport.commit_sha} does not match HEAD ${headAfter}`,
    };
  }

  const reportedFiles = new Set(implementationReport.changed_files.map(normalizeGitPath));
  const actualFeatureFiles = changedFiles.filter(file => !isAllowedManagedFile(file, feature.id));
  if (!sameFileSet(reportedFiles, new Set(actualFeatureFiles))) {
    return {
      outcome: 'retry',
      summary: 'Implementation report changed_files does not match the committed feature diff',
    };
  }

  const missingCommands = contract.commands_to_run.filter(command => !implementationReport.commands_run.includes(command));
  if (missingCommands.length > 0) {
    return {
      outcome: 'retry',
      summary: `Implementation report omitted required contract commands: ${missingCommands.join(', ')}`,
    };
  }

  const commandFailures = implementationReport.verification_results.filter(result => result.status !== 'pass');
  if (commandFailures.length > 0 && implementationReport.outcome === 'ready_for_review') {
    return {
      outcome: 'retry',
      summary: `Implementation reported non-passing verification commands: ${commandFailures.map(result => result.command).join(', ')}`,
    };
  }

  if (config.skipReview) {
    return { outcome: 'approved', summary: 'Implementation ready and reviewer step skipped by configuration' };
  }

  const verificationReport = await runRetryablePhase({
    runner,
    config,
    cwd,
    prompt: buildVerificationPrompt(
      evaluatorPromptPath,
      paths.assignmentPath,
      paths.contractPath,
      paths.implementationReportPath,
      paths.verificationReportPath,
    ),
    readArtifact: () => readVerificationReport(paths.verificationReportPath),
    artifactPaths: [paths.verificationReportPath],
    budget: verifierBudget,
    recoveryBudget: boostBudget(verifierBudget, 4, 2 * 60 * 1000),
  });
  if (!verificationReport) {
    return { outcome: 'retry', summary: 'Verifier did not write a valid verification-report.json artifact' };
  }

  const missingVerifiedCommands = contract.commands_to_run.filter(command =>
    !verificationReport.command_results.some(result => result.command === command),
  );
  if (missingVerifiedCommands.length > 0) {
    return {
      outcome: 'retry',
      summary: `Verification report omitted required contract commands: ${missingVerifiedCommands.join(', ')}`,
    };
  }

  const missingAcceptanceChecks = contract.acceptance_checks.filter(check =>
    !isAcceptanceCheckSatisfied(verificationReport, check),
  );
  if (missingAcceptanceChecks.length > 0) {
    return {
      outcome: 'retry',
      summary: `Verification report omitted required acceptance checks: ${missingAcceptanceChecks.join(', ')}`,
    };
  }

  if (verificationReport.outcome === 'approved') {
    const failedVerifiedCommands = verificationReport.command_results
      .filter(result => contract.commands_to_run.includes(result.command) && result.status !== 'pass');
    if (failedVerifiedCommands.length > 0) {
      return {
        outcome: 'retry',
        summary: `Verification approved despite non-passing command results: ${failedVerifiedCommands.map(result => result.command).join(', ')}`,
      };
    }

    const unapprovedAcceptanceChecks = contract.acceptance_checks.filter(check => {
      const matches = findMatchingAcceptanceResults(verificationReport, check);
      return matches.length > 0 && !matches.some(result => result.status === 'pass');
    });
    if (unapprovedAcceptanceChecks.length > 0) {
      return {
        outcome: 'retry',
        summary: `Verification approved despite non-passing acceptance checks: ${unapprovedAcceptanceChecks.join(', ')}`,
      };
    }
  }

  return { outcome: verificationReport.outcome, summary: verificationReport.summary };
}

function buildPlannerLaunchPrompt(promptPath: string, assignmentPath: string, contractPath: string): string {
  return [
    `Your task instructions are in ${promptPath}.`,
    `Read ${assignmentPath} first, then write exactly one valid JSON file at ${contractPath}.`,
    'Do not spend turns narrating your role or project state.',
    'When the contract file is written, stop immediately.',
    'Do not implement code in this phase. Do not edit feature_list.json.',
  ].join(' ');
}

function buildContractReviewPrompt(
  promptPath: string,
  assignmentPath: string,
  contractPath: string,
  outputPath: string,
): string {
  return [
    `Your task instructions are in ${promptPath}.`,
    `Mode: CONTRACT_REVIEW.`,
    `Read ${assignmentPath} and ${contractPath}, then write exactly one valid JSON file at ${outputPath}.`,
    'Do not spend turns narrating your role or project state.',
    'When the review file is written, stop immediately.',
    'Do not implement code in this phase. Do not edit feature_list.json.',
  ].join(' ');
}

function buildImplementerLaunchPrompt(
  promptPath: string,
  assignmentPath: string,
  contractPath: string,
  outputPath: string,
): string {
  return [
    `Your task instructions are in ${promptPath}.`,
    `Read ${assignmentPath} and ${contractPath} first.`,
    'Start editing code quickly. Do not spend turns restating the assignment or phase.',
    `After implementation, write exactly one valid JSON file at ${outputPath}.`,
    'Create exactly one feature-scoped git commit, then stop immediately after writing the report.',
    'Do not implement future features, do not touch files that are outside the approved contract scope, and do not edit feature_list.json.',
    'The framework owns feature status changes.',
  ].join(' ');
}

function buildVerificationPrompt(
  promptPath: string,
  assignmentPath: string,
  contractPath: string,
  implementationReportPath: string,
  outputPath: string,
): string {
  return [
    `Your task instructions are in ${promptPath}.`,
    `Mode: VERIFICATION_REVIEW.`,
    `Read ${assignmentPath}, ${contractPath}, and ${implementationReportPath}, then write exactly one valid JSON file at ${outputPath}.`,
    'Do not spend turns narrating your role or project state.',
    'When the verification file is written, stop immediately.',
    'Do not implement code in this phase. Do not edit feature_list.json.',
  ].join(' ');
}

async function runRetryablePhase<TArtifact>(options: PhaseRunOptions<TArtifact>): Promise<TArtifact | null> {
  const {
    runner,
    config,
    cwd,
    prompt,
    readArtifact,
    artifactPaths,
    budget,
    recoveryBudget,
  } = options;

  const budgets = recoveryBudget ? [budget, recoveryBudget] : [budget];

  for (let attempt = 0; attempt < budgets.length; attempt++) {
    if (attempt > 0) {
      await clearArtifacts(artifactPaths);
    }

    const currentBudget = budgets[attempt]!;
    await runner.invoke(prompt, {
      verbose: config.verbose,
      debug: config.debug,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      stream: config.stream,
      settingSources: 'project,local',
      cwd,
      maxTurns: currentBudget.maxTurns,
      timeout: currentBudget.timeoutMs,
    });

    const artifact = await readArtifact();
    if (artifact) {
      return artifact;
    }
  }

  return null;
}

async function clearArtifacts(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;
    await rm(filePath, { force: true });
  }
}

function getPlannerBudget(feature: Feature): PhaseBudget {
  const complexity = getPlanningComplexity(feature);
  return {
    maxTurns: PLANNER_MAX_TURNS + Math.min(6, complexity),
    timeoutMs: PLANNER_TIMEOUT_MS + (Math.min(4, complexity) * 60 * 1000),
  };
}

function getContractReviewBudget(feature: Feature): PhaseBudget {
  const complexity = getPlanningComplexity(feature);
  return {
    maxTurns: CONTRACT_REVIEW_MAX_TURNS + Math.min(5, complexity),
    timeoutMs: CONTRACT_REVIEW_TIMEOUT_MS + (Math.min(3, complexity) * 60 * 1000),
  };
}

function getVerifierBudget(feature: Feature): PhaseBudget {
  const complexity = getPlanningComplexity(feature);
  return {
    maxTurns: VERIFIER_MAX_TURNS + Math.min(4, complexity),
    timeoutMs: VERIFIER_TIMEOUT_MS + (Math.min(3, complexity) * 60 * 1000),
  };
}

function boostBudget(budget: PhaseBudget, extraTurns: number, extraTimeoutMs: number): PhaseBudget {
  return {
    maxTurns: budget.maxTurns + extraTurns,
    timeoutMs: budget.timeoutMs + extraTimeoutMs,
  };
}

function getPlanningComplexity(feature: Feature): number {
  let complexity = 0;
  complexity += Math.max(0, (feature.acceptance_criteria?.length ?? 0) - 4);
  complexity += Math.max(0, (feature.related_files?.length ?? 0) - 2);
  complexity += Math.min(3, feature.attempts ?? 0);
  complexity += Math.min(2, feature.depends_on?.length ?? 0);

  if (isBootstrapFeature(feature)) {
    complexity += 3;
  }

  return complexity;
}

function isBootstrapFeature(feature: Feature): boolean {
  if (BOOTSTRAP_FEATURE_PATTERN.test(feature.description)) {
    return true;
  }

  return (feature.related_files ?? []).some(file => {
    const normalized = normalizeGitPath(file);
    return normalized === 'package.json'
      || normalized === 'tsconfig.json'
      || normalized === 'tsconfig.base.json';
  });
}

async function getCurrentCommit(cwd: string): Promise<string> {
  const { stdout } = await gitExec(['rev-parse', 'HEAD'], cwd);
  return stdout.trim();
}

async function commitRefMatchesHead(cwd: string, commitRef: string, headCommit: string): Promise<boolean> {
  if (commitRef === headCommit) {
    return true;
  }

  try {
    const { stdout } = await gitExec(['rev-parse', commitRef], cwd);
    return stdout.trim() === headCommit;
  } catch {
    return false;
  }
}

async function getCurrentCommitSubject(cwd: string): Promise<string> {
  const { stdout } = await gitExec(['log', '-1', '--pretty=%s'], cwd);
  return stdout.trim();
}

async function getCommitCountSince(cwd: string, baseCommit: string): Promise<number> {
  const { stdout } = await gitExec(['rev-list', '--count', `${baseCommit}..HEAD`], cwd);
  return Number(stdout.trim()) || 0;
}

async function getChangedFilesSince(cwd: string, baseCommit: string): Promise<string[]> {
  const { stdout } = await gitExec(['diff', '--name-only', `${baseCommit}..HEAD`], cwd);
  return stdout
    .split('\n')
    .map(line => normalizeGitPath(line))
    .filter(Boolean);
}

async function getDirtyFiles(cwd: string): Promise<string[]> {
  const commands = [
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ] as const;

  const files = new Set<string>();
  for (const args of commands) {
    const { stdout } = await gitExec([...args], cwd);
    for (const line of stdout.split('\n')) {
      const file = normalizeGitPath(line);
      if (file) files.add(file);
    }
  }

  return [...files];
}

function isAllowedManagedFile(file: string, featureId: string): boolean {
  return file === 'feature_list.json'
    || file === 'claude-progress.txt'
    || file.startsWith(normalizeGitPath('.ralph/prompts/'))
    || file.startsWith(normalizeGitPath(`.ralph/features/${featureId}/`));
}

function isAllowedFeatureFile(
  file: string,
  featureId: string,
  contract: NonNullable<Awaited<ReturnType<typeof readFeatureContract>>>,
  feature: Feature,
): boolean {
  if (isAllowedManagedFile(file, featureId)) return true;
  if (DEFAULT_ALLOWED_EXTRA_FILES.has(file)) return true;
  if (isBootstrapFeature(feature) && BOOTSTRAP_ALLOWED_EXTRA_FILES.has(file)) return true;

  const allowedFiles = new Set([
    ...contract.files_to_touch.map(normalizeGitPath),
  ]);

  return allowedFiles.has(file);
}

function normalizeGitPath(file: string): string {
  return file.trim().replace(/\\/g, '/');
}

function getCommitSubject(commitMessage: string): string {
  return commitMessage.split(/\r?\n/, 1)[0]?.trim() ?? '';
}

function isAcceptanceCheckSatisfied(
  verificationReport: NonNullable<Awaited<ReturnType<typeof readVerificationReport>>>,
  criterion: string,
): boolean {
  if (findMatchingAcceptanceResults(verificationReport, criterion).some(result => result.status === 'pass')) {
    return true;
  }

  const normalizedCriterion = normalizeAcceptanceText(criterion);
  return verificationReport.command_results.some(result =>
    result.status === 'pass'
    && normalizedCriterion.includes(normalizeAcceptanceText(result.command)),
  );
}

function findMatchingAcceptanceResults(
  verificationReport: NonNullable<Awaited<ReturnType<typeof readVerificationReport>>>,
  criterion: string,
) {
  return verificationReport.acceptance_results.filter(result => {
    const candidateText = `${result.criterion} ${result.notes ?? ''}`.trim();
    return acceptanceTextsMatch(criterion, candidateText);
  });
}

function acceptanceTextsMatch(requiredText: string, candidateText: string): boolean {
  const normalizedRequired = normalizeAcceptanceText(requiredText);
  const normalizedCandidate = normalizeAcceptanceText(candidateText);
  if (!normalizedRequired || !normalizedCandidate) {
    return false;
  }

  if (normalizedRequired === normalizedCandidate
    || normalizedRequired.includes(normalizedCandidate)
    || normalizedCandidate.includes(normalizedRequired)) {
    return true;
  }

  const requiredTokens = tokenizeAcceptanceText(normalizedRequired);
  const candidateTokens = tokenizeAcceptanceText(normalizedCandidate);
  if (requiredTokens.size === 0 || candidateTokens.size === 0) {
    return false;
  }

  const overlap = [...requiredTokens].filter(token => candidateTokens.has(token)).length;
  const requiredCoverage = overlap / requiredTokens.size;
  const candidateCoverage = overlap / candidateTokens.size;

  return requiredCoverage >= 0.72 || (requiredCoverage >= 0.6 && candidateCoverage >= 0.55);
}

function tokenizeAcceptanceText(value: string): Set<string> {
  return new Set(
    value
      .split(' ')
      .map(token => token.trim())
      .filter(token => token.length > 1 && !ACCEPTANCE_MATCH_STOP_WORDS.has(token)),
  );
}

function normalizeAcceptanceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'{}()[\],.:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameFileSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

async function cleanupEphemeralDirtyFiles(cwd: string, dirtyFiles: string[]): Promise<void> {
  const untrackedFiles = await getUntrackedFiles(cwd);

  for (const file of dirtyFiles) {
    if (!untrackedFiles.has(file) || !isEphemeralOutputFile(file)) {
      continue;
    }

    await rm(path.join(cwd, file), { recursive: true, force: true });
  }
}

function resolvePromptPath(cwd: string, promptsDir: string, fileName: string): string {
  const localPromptPath = path.join(cwd, '.ralph', 'prompts', fileName);
  if (existsSync(localPromptPath)) {
    return localPromptPath;
  }

  return path.join(promptsDir, fileName);
}

async function getUntrackedFiles(cwd: string): Promise<Set<string>> {
  const { stdout } = await gitExec(['ls-files', '--others', '--exclude-standard'], cwd);
  return new Set(
    stdout
      .split('\n')
      .map(line => normalizeGitPath(line))
      .filter(Boolean),
  );
}

function isEphemeralOutputFile(file: string): boolean {
  return EPHEMERAL_OUTPUT_PREFIXES.some(prefix => file.startsWith(prefix))
    || EPHEMERAL_OUTPUT_SUFFIXES.some(suffix => file.endsWith(suffix));
}
