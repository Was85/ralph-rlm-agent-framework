import path from 'node:path';
import type { Runner, RunnerConfig, RalphConfig, FeatureList } from '../config/types.js';
import { FEATURE_LIST_FILE } from '../config/defaults.js';
import * as featureStore from '../core/feature-store.js';
import { recalculateStats } from '../core/stats.js';
import * as logger from '../ui/logger.js';
import { formatProgressSnapshot } from '../ui/progress-display.js';
import { formatPostRunReport } from '../ui/post-run-report.js';

const BASE_MAX_TURNS = 50;
const TURNS_PER_FEATURE = 5;

export class TeamOrchestrator {
  private readonly featureListPath: string;

  constructor(
    private readonly runner: Runner,
    private readonly config: RalphConfig,
    private readonly cwd: string,
  ) {
    this.featureListPath = path.join(cwd, FEATURE_LIST_FILE);
  }

  async run(): Promise<number> {
    const initial = await this.readFeatures();
    const initialRemaining = this.remaining(initial);
    const initialBlocked = this.blockedCount(initial);

    if (initialRemaining === 0 && initialBlocked === 0) {
      logger.success(`All features are already complete! Nothing to do.`);
      return 0;
    }

    if (initialRemaining === 0 && initialBlocked > 0) {
      logger.warning(`No pending features, but ${initialBlocked} feature(s) are blocked`);
      logger.info('Fix blocked features in feature_list.json and re-run');
      return 2;
    }

    logger.info(`${initialRemaining} feature(s) remaining to implement`);

    let iteration = 0;
    while (iteration < this.config.maxIterations) {
      const data = await this.readFeatures();
      const remaining = this.remaining(data);
      const blocked = this.blockedCount(data);
      const completeCount = data.features.filter(f => f.status === 'complete').length;
      const total = data.features.length;

      if (remaining === 0 && blocked === 0) {
        logger.success(`ALL FEATURES COMPLETE! (${completeCount}/${total})`);
        this.printReport(data);
        return 0;
      }

      if (remaining === 0 && blocked > 0) {
        logger.warning(`BLOCKED - Human intervention needed (${completeCount}/${total} complete, ${blocked} blocked)`);
        this.printReport(data);
        return 2;
      }

      logger.info(`--- Implementation Iteration ${iteration + 1} of ${this.config.maxIterations} ---`);
      logger.info(formatProgressSnapshot(data));

      const maxTurns = BASE_MAX_TURNS + (remaining * TURNS_PER_FEATURE);

      const runnerConfig: RunnerConfig = {
        verbose: this.config.verbose,
        debug: this.config.debug,
        dangerouslySkipPermissions: this.config.dangerouslySkipPermissions,
        stream: this.config.stream,
        maxTurns,
      };

      const prompt = this.buildPrompt(data, iteration);
      await this.runner.invoke(prompt, runnerConfig);

      await this.repairStats();
      const afterData = await this.readFeatures();
      logger.info(`Iteration ${iteration + 1} complete`);
      logger.info(formatProgressSnapshot(afterData));

      iteration++;
    }

    logger.warning(`Max implementation iterations reached (${this.config.maxIterations})`);
    await this.repairStats();
    const finalData = await this.readFeatures();
    this.printReport(finalData);

    const finalRemaining = this.remaining(finalData);
    const finalComplete = finalData.features.filter(f => f.status === 'complete').length;
    const finalBlocked = this.blockedCount(finalData);
    logger.info(`Final: ${finalComplete}/${finalData.features.length} complete, ${finalRemaining} remaining, ${finalBlocked} blocked`);

    return 1;
  }

  private async readFeatures(): Promise<FeatureList> {
    return featureStore.read(this.featureListPath);
  }

  private remaining(data: FeatureList): number {
    return data.features.filter(f => f.status === 'pending' || f.status === 'in_progress').length;
  }

  private blockedCount(data: FeatureList): number {
    return data.features.filter(f => f.status === 'blocked').length;
  }

  private async repairStats(): Promise<void> {
    try {
      const data = await this.readFeatures();
      recalculateStats(data);
      await featureStore.write(this.featureListPath, data);
    } catch {
      logger.debugLog('Stats repair failed', this.config.verbose);
    }
  }

  private printReport(data: FeatureList): void {
    const lines = formatPostRunReport(data);
    for (const line of lines) {
      console.log(line);
    }
  }

  private buildPrompt(data: FeatureList, iteration: number): string {
    const remaining = this.remaining(data);
    const lines = [
      `Implement the remaining ${remaining} features from feature_list.json.`,
      '',
      '## Configuration',
      `- Teammates: ${this.config.teammates}`,
      `- WithReviewer: ${!this.config.skipReview}`,
      `- Remaining features: ${remaining}`,
      `- Working directory: ${this.cwd}`,
      `- Iteration: ${iteration + 1} of ${this.config.maxIterations}`,
    ];
    return lines.join('\n');
  }
}
