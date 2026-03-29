import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { runPreflight } from '../core/preflight.js';
import { FEATURE_LIST_FILE } from '../config/defaults.js';
import * as logger from '../ui/logger.js';
import { recalculateStats } from '../core/stats.js';
import {
  formatFeatureQualityIssues,
  normalizeFeatureListQuality,
  validateFeatureListQuality,
} from '../core/feature-quality-gates.js';

export async function runOptimize(
  config: RalphConfig,
  promptsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('OPTIMIZE FEATURE LIST');
  logger.info('Running optimizer agent to improve feature_list.json...');

  if (!(await runPreflight('optimize', config.runner, promptsDir, cwd))) {
    return 1;
  }

  const featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  if (!existsSync(featureListPath)) {
    logger.error('feature_list.json not found. Run ralph init first.');
    return 1;
  }
  const beforeRaw = await readFile(featureListPath, 'utf-8');

  const optimizerPromptPath = path.join(promptsDir, 'optimizer.md');

  const prompt = `Your task instructions are in the file: ${optimizerPromptPath} — read it first.

Then read these files in the current working directory:
- feature_list.json — this is what you will improve
- prd.md — the source of truth (read-only, do NOT modify)

Go through EVERY feature and make each one small, detailed, and testable.
Compare against prd.md to ensure complete coverage.
Write the improved feature_list.json back to disk.
Do NOT create any other files. Do NOT implement any code.
Every feature must include precise priority, depends_on, source_requirement, related_files, explicit acceptance criteria, and verification steps. If config.build_command or config.test_command exist, every feature must include them in both acceptance criteria and verification steps. UI work must cite Playwright/E2E evidence; non-UI work must cite unit-test evidence.`;

  const runnerExitCode = await runner.invoke(prompt, {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
    settingSources: 'project,local',
    maxTurns: 5,
  });

  // Validate feature_list.json is still valid after optimizer
  try {
    const raw = await readFile(featureListPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.features)) {
      logger.error('feature_list.json is missing .features array after optimization');
      return 1;
    }
    const normalizations = normalizeFeatureListQuality(data);
    recalculateStats(data);
    await writeFile(featureListPath, JSON.stringify(data, null, 2), 'utf-8');
    if (normalizations.length > 0) {
      logger.info(`Applied ${normalizations.length} deterministic feature-list quality fix(es) after optimization.`);
    }
    let qualityIssues = validateFeatureListQuality(data);
    if (qualityIssues.length > 0) {
      logger.warning('Optimizer output failed the quality gate. Running one targeted repair pass...');
      await runner.invoke(buildOptimizeRepairPrompt(optimizerPromptPath, qualityIssues), {
        verbose: config.verbose,
        debug: config.debug,
        dangerouslySkipPermissions: config.dangerouslySkipPermissions,
        stream: config.stream,
        settingSources: 'project,local',
        maxTurns: 3,
      });

      const repairedRaw = await readFile(featureListPath, 'utf-8');
      const repairedData = JSON.parse(repairedRaw);
      const repairNormalizations = normalizeFeatureListQuality(repairedData);
      recalculateStats(repairedData);
      await writeFile(featureListPath, JSON.stringify(repairedData, null, 2), 'utf-8');
      if (repairNormalizations.length > 0) {
        logger.info(`Applied ${repairNormalizations.length} deterministic feature-list quality fix(es) after optimization repair.`);
      }
      qualityIssues = validateFeatureListQuality(repairedData);
    }
    if (qualityIssues.length > 0) {
      logger.error('Optimizer produced a feature_list.json that failed the Phase 3 quality gates:');
      for (const line of formatFeatureQualityIssues(qualityIssues)) {
        logger.error(`  - ${line}`);
      }
      return 1;
    }
    if (runnerExitCode !== 0 && raw === beforeRaw) {
      logger.warning(`Optimizer exited with code ${runnerExitCode} without changes, but the current feature_list.json already satisfies the quality gates`);
      logger.success(`Optimization complete. ${data.features.length} features in list.`);
      return 0;
    }
    if (runnerExitCode !== 0) {
      logger.warning(`Optimizer exited with code ${runnerExitCode}, but a valid feature_list.json was produced`);
    }
    logger.success(`Optimization complete. ${data.features.length} features in list.`);
    return 0;
  } catch {
    logger.error('feature_list.json is invalid JSON after optimization');
    return 1;
  }
}

function buildOptimizeRepairPrompt(
  optimizerPromptPath: string,
  qualityIssues: ReturnType<typeof validateFeatureListQuality>,
): string {
  const issueLines = formatFeatureQualityIssues(qualityIssues).slice(0, 20);
  const omittedCount = Math.max(0, qualityIssues.length - issueLines.length);
  const issueSummary = issueLines.join(' | ');
  const omittedSummary = omittedCount > 0 ? ` | plus ${omittedCount} additional quality issue(s)` : '';

  return `Your previous feature_list.json failed Ralph's quality gate. Read ${optimizerPromptPath}, then read prd.md and feature_list.json in the current working directory. Fix ONLY feature_list.json so all issues are resolved while preserving valid work. Do NOT create code. Specific issues: ${issueSummary}${omittedSummary}`;
}
