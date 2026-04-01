import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import * as logger from '../ui/logger.js';
import { gitExec } from '../core/safe-exec.js';
import { recalculateStats } from '../core/stats.js';
import {
  formatFeatureQualityIssues,
  normalizeFeatureListQuality,
  validateFeatureListQuality,
} from '../core/feature-quality-gates.js';

const INIT_MAX_TURNS = 25;
const INIT_REPAIR_MAX_TURNS = 15;

const INIT_STASH_EXCLUDES = [
  ':(exclude).ralph/**',
  ':(exclude).claude/**',
  ':(exclude).github/**',
  ':(exclude)templates/**',
  ':(exclude)prd.md',
  ':(exclude)feature_list.json',
  ':(exclude)claude-progress.txt',
  ':(exclude)validation-state.json',
];

/**
 * Undo any source files the init agent created beyond the allowed outputs.
 * Preserves feature_list.json, claude-progress.txt, and framework dirs (.ralph/, .claude/, .github/).
 */
async function undoInitCodeChanges(cwd: string, featureListPath: string, progressPath: string): Promise<void> {
  try {
    // Save the files we want to keep
    const featureListContent = await readFile(featureListPath, 'utf-8');
    const progressContent = existsSync(progressPath) ? await readFile(progressPath, 'utf-8') : null;

    // Reset all tracked changes and remove untracked files (except framework dirs)
    await gitExec(['checkout', '--', '.'], cwd).catch(() => {});
    await gitExec([
      'clean', '-fd',
      '-e', '.ralph/',
      '-e', '.claude/',
      '-e', '.github/',
      '-e', 'templates/',
      '-e', 'prd.md',
      '-e', 'feature_list.json',
      '-e', 'claude-progress.txt',
      '-e', 'validation-state.json',
    ], cwd).catch(() => {});

    // Restore our outputs
    await writeFile(featureListPath, featureListContent, 'utf-8');
    if (progressContent !== null) {
      await writeFile(progressPath, progressContent, 'utf-8');
    }
  } catch {
    // Best effort — don't fail init if cleanup fails
  }
}

export async function runInit(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('PHASE 1: INITIALIZE');
  logger.info('Analyzing PRD and creating feature_list.json...');

  if (!(await runPreflight('init', config.runner, promptsDir, cwd))) {
    return 1;
  }

  const stashRef = await createInitSafetyStash(cwd);

  const initPromptPath = path.join(promptsDir, 'initializer.md');

  const prompt = `Your task instructions are in the file: ${initPromptPath} — the project requirements are in prd.md in the current working directory. Start by using your Read tool to open both files, then execute every instruction. CRITICAL CONSTRAINT: You MUST only create feature_list.json and claude-progress.txt. Do NOT write any application code, do NOT create source files, do NOT implement features. All feature statuses MUST be "pending". Every feature must be small enough for one iteration, include precise priority/depends_on/source_requirement/related_files fields, include real acceptance criteria, and include build/test plus unit-or-E2E verification evidence.`;

  logger.info('Running initializer agent...');

  const featureListPath = path.join(cwd, 'feature_list.json');
  const progressPath = path.join(cwd, 'claude-progress.txt');
  try {
    await runner.invoke(prompt, {
      verbose: config.verbose,
      debug: config.debug,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions,
      stream: config.stream,
      settingSources: 'project,local',
      maxTurns: INIT_MAX_TURNS,
    });

    if (existsSync(featureListPath)) {
      try {
        const raw = await readFile(featureListPath, 'utf-8');
        const data = JSON.parse(raw);
        const features = Array.isArray(data.features) ? data.features : [];
        const featureCount = features.length;

        // Safety check: all features should be pending after init
        const nonPending = features.filter((f: { status: string }) => f.status !== 'pending');
        if (nonPending.length > 0) {
          logger.warning(`${nonPending.length} feature(s) are not "pending" — init should not implement features. Resetting to pending.`);
          for (const f of features) {
            (f as { status: string }).status = 'pending';
            (f as { attempts: number }).attempts = 0;
          }
        }

        const normalizations = normalizeFeatureListQuality(data);
        recalculateStats(data);
        await writeFile(featureListPath, JSON.stringify(data, null, 2), 'utf-8');

        // Safety net: undo any source code the init agent may have created.
        await undoInitCodeChanges(cwd, featureListPath, progressPath);

        if (normalizations.length > 0) {
          logger.info(`Applied ${normalizations.length} deterministic feature-list quality fix(es) after initialization.`);
        }

        let qualityIssues = validateFeatureListQuality(data);
        if (qualityIssues.length > 0) {
          logger.warning('Initialization output failed the quality gate. Running one targeted repair pass...');
          await runner.invoke(buildInitRepairPrompt(initPromptPath, qualityIssues), {
            verbose: config.verbose,
            debug: config.debug,
            dangerouslySkipPermissions: config.dangerouslySkipPermissions,
            stream: config.stream,
            settingSources: 'project,local',
            maxTurns: INIT_REPAIR_MAX_TURNS,
          });

          const repairedRaw = await readFile(featureListPath, 'utf-8');
          const repairedData = JSON.parse(repairedRaw);
          const repairNormalizations = normalizeFeatureListQuality(repairedData);
          recalculateStats(repairedData);
          await writeFile(featureListPath, JSON.stringify(repairedData, null, 2), 'utf-8');
          if (repairNormalizations.length > 0) {
            logger.info(`Applied ${repairNormalizations.length} deterministic feature-list quality fix(es) after repair.`);
          }
          qualityIssues = validateFeatureListQuality(repairedData);
        }
        if (qualityIssues.length > 0) {
          logger.error('Initialization produced a feature_list.json that failed the Phase 3 quality gates:');
          for (const line of formatFeatureQualityIssues(qualityIssues)) {
            logger.error(`  - ${line}`);
          }
          return 1;
        }

        logger.success('Initialization complete!');
        logger.info(`Created ${featureCount} features in feature_list.json`);
        return 0;
      } catch {
        logger.error('feature_list.json created but could not be parsed');
        return 1;
      }
    } else {
      logger.error('Initialization failed - feature_list.json not created');
      return 1;
    }
  } finally {
    await restoreInitSafetyStash(cwd, stashRef);
  }
}

async function createInitSafetyStash(cwd: string): Promise<string | null> {
  try {
    const marker = `ralph-pre-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const before = await listStashes(cwd);
    await gitExec([
      'stash', 'push', '-m', marker, '--include-untracked',
      '--', '.', ...INIT_STASH_EXCLUDES,
    ], cwd);
    const after = await listStashes(cwd);
    const created = after.find(entry => !before.includes(entry) && entry.includes(marker));
    return created ? created.split(':', 1)[0] ?? null : null;
  } catch {
    return null;
  }
}

async function restoreInitSafetyStash(cwd: string, stashRef: string | null): Promise<void> {
  if (!stashRef) {
    return;
  }

  try {
    await gitExec(['stash', 'pop', stashRef], cwd);
  } catch {
    logger.warning(`Failed to restore init safety stash ${stashRef}.`);
  }
}

async function listStashes(cwd: string): Promise<string[]> {
  const { stdout } = await gitExec(['stash', 'list'], cwd);
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function buildInitRepairPrompt(
  initPromptPath: string,
  qualityIssues: ReturnType<typeof validateFeatureListQuality>,
): string {
  const issueLines = formatFeatureQualityIssues(qualityIssues).slice(0, 20);
  const omittedCount = Math.max(0, qualityIssues.length - issueLines.length);
  const issueSummary = issueLines.join(' | ');
  const omittedSummary = omittedCount > 0 ? ` | plus ${omittedCount} additional quality issue(s)` : '';

  return `Your previous feature_list.json failed Ralph's quality gate. Read ${initPromptPath}, then read prd.md and feature_list.json in the current working directory. Fix ONLY feature_list.json so every feature remains pending and all quality issues are resolved. Do NOT create code files. Do NOT implement features. Specific issues: ${issueSummary}${omittedSummary}`;
}
