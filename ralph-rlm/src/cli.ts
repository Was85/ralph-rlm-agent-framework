#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'node:path';
import { FEATURE_LIST_FILE } from './config/defaults.js';
import type { FeatureStatus } from './config/types.js';
import { buildConfig } from './config/build-config.js';
import { createRunner } from './runners/runner-factory.js';
import { runInit } from './commands/init.js';
import { runValidate } from './commands/validate.js';
import { runImplement } from './commands/run.js';
import { runAuto } from './commands/auto.js';
import { displayStatus } from './commands/status.js';
import { runAuthor } from './commands/author.js';
import { runScaffold } from './commands/scaffold.js';
import { getNextFeature } from './commands/skills/get-next-feature.js';
import { getFeatureStats } from './commands/skills/get-feature-stats.js';
import { updateFeatureStatus } from './commands/skills/update-feature-status.js';
import { incrementFeatureAttempts } from './commands/skills/increment-feature-attempts.js';
import { claimFeature } from './commands/skills/claim-feature.js';
import { TeamOrchestrator } from './team/team-orchestrator.js';
import { fileURLToPath } from 'node:url';

function resolvePromptsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
}

function resolveSkillsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills');
}

const cli = yargs(hideBin(process.argv))
  .scriptName('ralph')
  .usage('$0 <command> [options]')
  .epilog(`Getting started:
  1. ralph scaffold       Set up project files + prd.md template
  2. ralph author         Interactive PRD writing assistant (or edit prd.md manually)
  3. ralph auto           Run all phases: init -> validate -> implement

Docs: https://www.npmjs.com/package/@alcinanet/ralph-rlm`)
  .option('runner', {
    type: 'string',
    choices: ['claude', 'copilot'] as const,
    default: 'claude',
    describe: 'AI runner to use',
  })
  .option('max-iterations', {
    alias: 'm',
    type: 'number',
    default: 50,
    describe: 'Max implementation iterations',
  })
  .option('max-validate-iterations', {
    type: 'number',
    default: 10,
    describe: 'Max validation iterations',
  })
  .option('coverage-threshold', {
    alias: 'c',
    type: 'number',
    default: 95,
    describe: 'Coverage threshold percentage',
  })
  .option('sleep-between', {
    alias: 's',
    type: 'number',
    default: 2,
    describe: 'Seconds between iterations',
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Verbose output',
  })
  .option('debug', {
    type: 'boolean',
    default: false,
    describe: 'Debug output',
  })
  .option('dangerously-skip-permissions', {
    type: 'boolean',
    default: false,
    describe: 'Skip permission prompts',
  })
  .option('allow-all-tools', {
    type: 'boolean',
    default: false,
    describe: 'Alias for --dangerously-skip-permissions',
  })
  .option('stream', {
    type: 'boolean',
    default: false,
    describe: 'Stream AI output',
  })
  .command('init', 'Phase 1: PRD -> feature_list.json', {}, async (argv) => {
    const config = buildConfig(argv);
    const runner = createRunner(config.runner);
    const code = await runInit(config, resolvePromptsDir(), runner);
    process.exitCode = code;
  })
  .command('validate', 'Phase 2: coverage loop', {}, async (argv) => {
    const config = buildConfig(argv);
    const runner = createRunner(config.runner);
    const code = await runValidate(config, resolvePromptsDir(), runner);
    process.exitCode = code;
  })
  .command('run', 'Phase 3: implement features', (y) => {
    return y
      .option('team', {
        type: 'boolean',
        default: false,
        describe: 'Enable team mode',
      })
      .option('teammates', {
        type: 'number',
        default: 3,
        describe: 'Number of parallel teammates',
      })
      .option('skip-review', {
        type: 'boolean',
        default: false,
        describe: 'Skip code review step',
      });
  }, async (argv) => {
    const config = buildConfig(argv);
    const runner = createRunner(config.runner);

    if (config.team) {
      const orchestrator = new TeamOrchestrator(runner, config, resolvePromptsDir(), process.cwd());
      process.exitCode = await orchestrator.run();
    } else {
      process.exitCode = await runImplement(config, resolvePromptsDir(), runner);
    }
  })
  .command('auto', 'All phases sequentially', {}, async (argv) => {
    const config = buildConfig(argv);
    const runner = createRunner(config.runner);
    const code = await runAuto(config, resolvePromptsDir(), runner);
    process.exitCode = code;
  })
  .command('status', 'Show project state', {}, async () => {
    await displayStatus();
  })
  .command('scaffold', 'Set up Ralph framework files in current project', {}, async (argv) => {
    const runner = (argv['runner'] as 'claude' | 'copilot') ?? 'claude';
    process.exitCode = await runScaffold(runner);
  })
  .command('author', 'Interactive PRD assistant', {}, async (argv) => {
    const config = buildConfig(argv);
    const runner = createRunner(config.runner);
    const code = await runAuthor(config, resolveSkillsDir(), runner);
    process.exitCode = code;
  })
  .command('skill', 'Skill subcommand (for AI agents)', (y) => {
    return y
      .command('get-next-feature', 'Get the next feature to implement', (yy) => {
        return yy.option('path', {
          type: 'string',
          default: FEATURE_LIST_FILE,
          describe: 'Path to feature_list.json',
        });
      }, async (argv) => {
        const result = await getNextFeature(argv.path);
        console.log(JSON.stringify(result.data, null, 2));
        process.exitCode = result.success ? 0 : 1;
      })
      .command('get-feature-stats', 'Get project stats', (yy) => {
        return yy.option('path', {
          type: 'string',
          default: FEATURE_LIST_FILE,
          describe: 'Path to feature_list.json',
        });
      }, async (argv) => {
        const result = await getFeatureStats(argv.path);
        console.log(JSON.stringify(result.data, null, 2));
        process.exitCode = result.success ? 0 : 1;
      })
      .command('update-feature-status', 'Update a feature status', (yy) => {
        return yy
          .option('id', {
            type: 'string',
            demandOption: true,
            describe: 'Feature ID',
          })
          .option('status', {
            type: 'string',
            demandOption: true,
            choices: ['pending', 'in_progress', 'complete', 'blocked'] as const,
            describe: 'New status',
          })
          .option('path', {
            type: 'string',
            default: FEATURE_LIST_FILE,
            describe: 'Path to feature_list.json',
          });
      }, async (argv) => {
        const result = await updateFeatureStatus(argv.path, argv.id, argv.status as FeatureStatus);
        if (result.success) {
          console.log(JSON.stringify({ message: result.data }, null, 2));
        } else {
          console.error(JSON.stringify({ error: result.error }, null, 2));
        }
        process.exitCode = result.success ? 0 : 1;
      })
      .command('increment-feature-attempts', 'Increment feature attempts', (yy) => {
        return yy
          .option('id', {
            type: 'string',
            demandOption: true,
            describe: 'Feature ID',
          })
          .option('error', {
            type: 'string',
            describe: 'Error message to store',
          })
          .option('path', {
            type: 'string',
            default: FEATURE_LIST_FILE,
            describe: 'Path to feature_list.json',
          });
      }, async (argv) => {
        const result = await incrementFeatureAttempts(argv.path, argv.id, argv.error);
        if (result.success) {
          console.log(JSON.stringify({ message: result.data }, null, 2));
        } else {
          console.error(JSON.stringify({ error: result.error }, null, 2));
        }
        process.exitCode = result.success ? 0 : 1;
      })
      .command('claim-feature', 'Claim a feature for a teammate', (yy) => {
        return yy
          .option('teammate', {
            type: 'string',
            demandOption: true,
            describe: 'Teammate name',
          })
          .option('path', {
            type: 'string',
            default: FEATURE_LIST_FILE,
            describe: 'Path to feature_list.json',
          });
      }, async (argv) => {
        const result = await claimFeature(argv.path, argv.teammate);
        console.log(JSON.stringify(result.data, null, 2));
        process.exitCode = result.success ? 0 : 1;
      })
      .demandCommand(1, 'Please specify a skill subcommand')
      .strict();
  })
  .demandCommand(1, 'Please specify a command')
  .strict()
  .help();

await cli.parseAsync();
