import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ASSIGNMENT_FILE,
  CONTRACT_FILE,
  CONTRACT_REVIEW_FILE,
  IMPLEMENTATION_REPORT_FILE,
  POST_MERGE_VERIFICATION_FILE,
  VERIFICATION_REPORT_FILE,
} from '../config/defaults.js';
import type {
  PostMergeVerificationReport,
  AcceptanceResult,
  ContractReview,
  Feature,
  FeatureAssignment,
  FeatureContract,
  ImplementationReport,
  VerificationCommandResult,
  VerificationReport,
} from '../config/types.js';
import { resolveFeatureDir } from './ralph-paths.js';

export interface FeatureHarnessPaths {
  featureDir: string;
  assignmentPath: string;
  contractPath: string;
  contractReviewPath: string;
  implementationReportPath: string;
  verificationReportPath: string;
  postMergeVerificationPath: string;
}

export function getFeatureHarnessPaths(cwd: string, featureId: string): FeatureHarnessPaths {
  const featureDir = resolveFeatureDir(cwd, featureId);
  return {
    featureDir,
    assignmentPath: path.join(featureDir, ASSIGNMENT_FILE),
    contractPath: path.join(featureDir, CONTRACT_FILE),
    contractReviewPath: path.join(featureDir, CONTRACT_REVIEW_FILE),
    implementationReportPath: path.join(featureDir, IMPLEMENTATION_REPORT_FILE),
    verificationReportPath: path.join(featureDir, VERIFICATION_REPORT_FILE),
    postMergeVerificationPath: path.join(featureDir, POST_MERGE_VERIFICATION_FILE),
  };
}

export async function prepareFeatureHarness(cwd: string, feature: Feature): Promise<FeatureHarnessPaths> {
  const paths = getFeatureHarnessPaths(cwd, feature.id);
  await mkdir(paths.featureDir, { recursive: true });

  const assignment: FeatureAssignment = {
    feature_id: feature.id,
    description: feature.description,
    acceptance_criteria: feature.acceptance_criteria ?? [],
    verification_steps: feature.verification_steps ?? [],
    attempts: feature.attempts,
    priority: feature.priority ?? Number.MAX_SAFE_INTEGER,
    last_error: feature.last_error,
    source_requirement: feature.source_requirement,
    depends_on: feature.depends_on ?? [],
    related_files: feature.related_files ?? [],
  };

  await writeJson(paths.assignmentPath, assignment);
  await removeIfExists(paths.contractPath);
  await removeIfExists(paths.contractReviewPath);
  await removeIfExists(paths.implementationReportPath);
  await removeIfExists(paths.verificationReportPath);
  await removeIfExists(paths.postMergeVerificationPath);

  return paths;
}

export async function copyFeatureHarness(sourceCwd: string, targetCwd: string, featureId: string): Promise<void> {
  const sourceDir = resolveFeatureDir(sourceCwd, featureId);
  if (!existsSync(sourceDir)) return;

  const targetDir = resolveFeatureDir(targetCwd, featureId);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

export async function readFeatureContract(filePath: string): Promise<FeatureContract | null> {
  return readJsonArtifact<FeatureContract>(filePath, isFeatureContract);
}

export async function readContractReview(filePath: string): Promise<ContractReview | null> {
  return readJsonArtifact<ContractReview>(filePath, isContractReview);
}

export async function readImplementationReport(filePath: string): Promise<ImplementationReport | null> {
  return readJsonArtifact<ImplementationReport>(filePath, isImplementationReport);
}

export async function readVerificationReport(filePath: string): Promise<VerificationReport | null> {
  return readJsonArtifact<VerificationReport>(filePath, isVerificationReport);
}

export async function writePostMergeVerificationReport(
  filePath: string,
  report: PostMergeVerificationReport,
): Promise<void> {
  await writeJson(filePath, report);
}

async function readJsonArtifact<T>(
  filePath: string,
  guard: (value: unknown) => value is T,
): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Best effort.
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isFeatureContract(value: unknown): value is FeatureContract {
  if (!value || typeof value !== 'object') return false;
  const contract = value as Record<string, unknown>;
  return typeof contract['feature_id'] === 'string'
    && typeof contract['goal'] === 'string'
    && typeof contract['scope_summary'] === 'string'
    && isStringArray(contract['planned_changes'])
    && isStringArray(contract['files_to_touch'])
    && isStringArray(contract['commands_to_run'])
    && isStringArray(contract['acceptance_checks'])
    && typeof contract['commit_message'] === 'string'
    && isStringArray(contract['risks']);
}

function isContractReview(value: unknown): value is ContractReview {
  if (!value || typeof value !== 'object') return false;
  const review = value as Record<string, unknown>;
  return typeof review['feature_id'] === 'string'
    && typeof review['summary'] === 'string'
    && isStringArray(review['findings'])
    && (review['outcome'] === 'approved' || review['outcome'] === 'retry' || review['outcome'] === 'blocked');
}

function isImplementationReport(value: unknown): value is ImplementationReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  return typeof report['feature_id'] === 'string'
    && typeof report['summary'] === 'string'
    && typeof report['commit_sha'] === 'string'
    && isStringArray(report['changed_files'])
    && isStringArray(report['commands_run'])
    && isVerificationCommandResultArray(report['verification_results'])
    && isStringArray(report['notes'])
    && (
      report['outcome'] === 'ready_for_review'
      || report['outcome'] === 'retry'
      || report['outcome'] === 'blocked'
    );
}

function isVerificationReport(value: unknown): value is VerificationReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  if (
    typeof report['feature_id'] !== 'string'
    || typeof report['summary'] !== 'string'
    || !isStringArray(report['findings'])
    || !isVerificationCommandResultArray(report['command_results'])
    || (report['outcome'] !== 'approved' && report['outcome'] !== 'retry' && report['outcome'] !== 'blocked')
    || !isAcceptanceResultArray(report['acceptance_results'])
  ) {
    return false;
  }

  return true;
}

function isVerificationCommandResultArray(value: unknown): value is VerificationCommandResult[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const result = item as Record<string, unknown>;
    return typeof result['command'] === 'string'
      && typeof result['details'] === 'string'
      && (result['status'] === 'pass' || result['status'] === 'fail' || result['status'] === 'not_run');
  });
}

function isAcceptanceResultArray(value: unknown): value is AcceptanceResult[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const result = item as Record<string, unknown>;
    return typeof result['criterion'] === 'string'
      && typeof result['notes'] === 'string'
      && (result['status'] === 'pass' || result['status'] === 'fail' || result['status'] === 'untested');
  });
}
