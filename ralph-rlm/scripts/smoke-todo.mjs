#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');
const cliPath = path.join(packageRoot, 'dist', 'cli.js');
const prdFixturePath = path.join(repoRoot, 'smoke', 'todo-api-e2e', 'prd.md');
const completedFixtureDir = path.join(repoRoot, 'smoke', 'todo-api-e2e-phase4-run');
const teamBaselineFixtureDir = path.join(repoRoot, 'smoke', 'todo-api-e2e-team-baseline');

const options = parseArgs(process.argv.slice(2));

const gitBin = process.platform === 'win32' ? 'git.exe' : 'git';
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeBin = process.execPath;

async function main() {
  if (!existsSync(prdFixturePath)) {
    throw new Error(`PRD fixture not found: ${prdFixturePath}`);
  }
  if (!existsSync(completedFixtureDir)) {
    throw new Error(`Completed smoke fixture not found: ${completedFixtureDir}`);
  }
  if (!existsSync(teamBaselineFixtureDir)) {
    throw new Error(`Team baseline fixture not found: ${teamBaselineFixtureDir}`);
  }

  console.log(`[smoke] Building Ralph before smoke run`);
  runCommand(npmBin, ['run', 'build'], { cwd: packageRoot, stream: true });

  const workRoot = await mkdtemp(path.join(os.tmpdir(), 'ralph-smoke-'));
  let success = false;

  try {
    console.log(`[smoke] Work root: ${workRoot}`);
    console.log(`[smoke] Runner: ${options.runner}`);

    if (options.mode === 'all' || options.mode === 'sequential') {
      await runSequentialSmoke(path.join(workRoot, 'sequential'));
    }

    if (options.mode === 'all' || options.mode === 'team') {
      await runTeamSmoke(path.join(workRoot, 'team'));
    }

    success = true;
    console.log('[smoke] Todo smoke completed successfully');
  } finally {
    if (success && !options.keepWorkdir) {
      await rm(workRoot, { recursive: true, force: true });
      console.log('[smoke] Cleaned up smoke work root');
    } else {
      console.log(`[smoke] Preserved work root: ${workRoot}`);
    }
  }
}

async function runSequentialSmoke(workdir) {
  console.log(`[smoke][sequential] Creating fresh repo at ${workdir}`);
  await mkdir(workdir, { recursive: true });
  await cp(prdFixturePath, path.join(workdir, 'prd.md'));

  runCommand(gitBin, ['init'], { cwd: workdir });
  runCommand(gitBin, ['config', 'user.email', 'smoke@example.com'], { cwd: workdir });
  runCommand(gitBin, ['config', 'user.name', 'Ralph Smoke'], { cwd: workdir });
  runCommand(gitBin, ['add', 'prd.md'], { cwd: workdir });
  runCommand(gitBin, ['commit', '-m', 'docs: add smoke PRD'], { cwd: workdir });

  console.log('[smoke][sequential] Running init');
  runRalph(['init'], workdir, { stream: true });

  console.log('[smoke][sequential] Running validate');
  runRalph(['validate'], workdir, { stream: true });

  console.log('[smoke][sequential] Running optimize');
  runRalph(['optimize'], workdir, { stream: true });

  console.log('[smoke][sequential] Running sequential harness');
  runRalph(['run', '--sleep-between', '0'], workdir, { stream: true });

  const statusOutput = runRalph(['status'], workdir, { capture: true }).stdout;
  console.log('[smoke][sequential] Final status:');
  process.stdout.write(statusOutput);

  const featureList = await readJson(path.join(workdir, 'feature_list.json'));
  assert(featureList?.stats?.complete === 8, 'Sequential smoke expected 8 complete features');
  assert(featureList?.stats?.pending === 0, 'Sequential smoke expected 0 pending features');
  assert(featureList?.stats?.blocked === 0, 'Sequential smoke expected 0 blocked features');

  const runtimeSession = await readJson(path.join(workdir, '.ralph', 'runtime', 'session-state.json'));
  assert(runtimeSession?.status === 'completed', 'Sequential smoke expected completed runtime status');
  assert(runtimeSession?.mode === 'sequential', 'Sequential smoke expected sequential runtime mode');

  const completeFeatureIds = featureList.features
    .filter(feature => feature.status === 'complete')
    .map(feature => feature.id);

  for (const featureId of completeFeatureIds) {
    assert(
      existsSync(path.join(workdir, '.ralph', 'features', featureId, 'verification-report.json')),
      `Sequential smoke expected verification-report.json for ${featureId}`,
    );
    assert(
      existsSync(path.join(workdir, '.ralph', 'features', featureId, 'post-merge-verification.json')),
      `Sequential smoke expected post-merge-verification.json for ${featureId}`,
    );
  }

  console.log('[smoke][sequential] Verifying finished app');
  runCommand(npmBin, ['run', 'build'], { cwd: workdir, stream: true });
  runCommand(npmBin, ['test'], { cwd: workdir, stream: true });
}

async function runTeamSmoke(workdir) {
  console.log(`[smoke][team] Seeding team baseline into ${workdir}`);
  await mkdir(workdir, { recursive: true });
  await cp(teamBaselineFixtureDir, workdir, { recursive: true });
  const baselineFeatureList = await readJson(path.join(teamBaselineFixtureDir, 'feature_list.json'));
  const baselineCompleteFeatureIds = new Set(
    baselineFeatureList.features
      .filter(feature => feature.status === 'complete')
      .map(feature => feature.id),
  );
  runCommand(gitBin, ['init'], { cwd: workdir });
  runCommand(gitBin, ['config', 'user.email', 'smoke@example.com'], { cwd: workdir });
  runCommand(gitBin, ['config', 'user.name', 'Ralph Smoke'], { cwd: workdir });
  runCommand(gitBin, ['checkout', '-b', 'phase5-team-smoke'], { cwd: workdir });
  runCommand(gitBin, ['add', '.'], { cwd: workdir });
  runCommand(gitBin, ['commit', '-m', 'test: seed team baseline fixture'], { cwd: workdir });
  await cp(prdFixturePath, path.join(workdir, 'prd.md'));
  runCommand(npmBin, ['ci'], { cwd: workdir, stream: true });
  runCommand(gitBin, ['add', 'prd.md', 'package-lock.json'], { cwd: workdir });
  runCommand(gitBin, ['commit', '-m', 'docs: restore prd for team smoke'], { cwd: workdir });

  console.log('[smoke][team] Running team harness');
  runRalph(['run', '--team', '--teammates', String(options.teammates), '--sleep-between', '0'], workdir, { stream: true });

  const statusOutput = runRalph(['status'], workdir, { capture: true }).stdout;
  console.log('[smoke][team] Final status:');
  process.stdout.write(statusOutput);

  const featureList = await readJson(path.join(workdir, 'feature_list.json'));
  assert(featureList?.stats?.complete === featureList.features.length, 'Team smoke expected all features to be complete');
  assert(featureList?.stats?.pending === 0, 'Team smoke expected 0 pending features');
  assert(featureList?.stats?.blocked === 0, 'Team smoke expected 0 blocked features');

  const runtimeSession = await readJson(path.join(workdir, '.ralph', 'runtime', 'session-state.json'));
  assert(runtimeSession?.status === 'completed', 'Team smoke expected completed runtime status');
  assert(runtimeSession?.mode === 'team', 'Team smoke expected team runtime mode');

  const completeFeatureIds = featureList.features
    .filter(feature => feature.status === 'complete')
    .map(feature => feature.id);

  for (const featureId of completeFeatureIds) {
    if (!baselineCompleteFeatureIds.has(featureId)) {
      const logOutput = runCommand(gitBin, ['log', '--oneline', '--grep', `feat(${featureId}):`], {
        cwd: workdir,
        capture: true,
      }).stdout.trim();
      assert(logOutput.length > 0, `Team smoke expected a feature commit for ${featureId}`);
    }
    assert(
      existsSync(path.join(workdir, '.ralph', 'features', featureId, 'verification-report.json')),
      `Team smoke expected verification-report.json for ${featureId}`,
    );
    assert(
      existsSync(path.join(workdir, '.ralph', 'features', featureId, 'post-merge-verification.json')),
      `Team smoke expected post-merge-verification.json for ${featureId}`,
    );
  }

  console.log('[smoke][team] Verifying finished app');
  runCommand(npmBin, ['run', 'build'], { cwd: workdir, stream: true });
  runCommand(npmBin, ['test'], { cwd: workdir, stream: true });
}

function runRalph(args, cwd, optionsOverride = {}) {
  const runnerArgs = [
    cliPath,
    ...args,
    '--runner',
    options.runner,
    '--dangerously-skip-permissions',
  ];
  return runCommand(nodeBin, runnerArgs, {
    cwd,
    stream: false,
    capture: !optionsOverride.stream,
    ...optionsOverride,
  });
}

function runCommand(command, args, optionsOverride = {}) {
  const {
    cwd = packageRoot,
    capture = true,
    stream = false,
    env,
  } = optionsOverride;

  const commandInvocation = buildInvocation(command, args);
  const result = spawnSync(commandInvocation.command, commandInvocation.args, {
    cwd,
    env: env ?? process.env,
    encoding: 'utf8',
    stdio: stream ? 'inherit' : 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const commandText = [command, ...args].join(' ');
    const details = capture && !stream
      ? `\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`
      : '';
    throw new Error(`Command failed (${result.status}): ${commandText}${details}`);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 0,
  };
}

function buildInvocation(command, args) {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args };
  }

  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandText = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
  return {
    command: comspec,
    args: ['/d', '/s', '/c', commandText],
  };
}

function quoteForCmd(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const parsed = {
    mode: 'all',
    runner: 'claude',
    teammates: 2,
    keepWorkdir: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--mode':
        parsed.mode = argv[++index] ?? parsed.mode;
        break;
      case '--runner':
        parsed.runner = argv[++index] ?? parsed.runner;
        break;
      case '--teammates':
        parsed.teammates = Number(argv[++index] ?? parsed.teammates);
        break;
      case '--keep-workdir':
        parsed.keepWorkdir = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  assert(['all', 'sequential', 'team'].includes(parsed.mode), `Invalid mode: ${parsed.mode}`);
  assert(['claude', 'copilot'].includes(parsed.runner), `Invalid runner: ${parsed.runner}`);
  assert(Number.isInteger(parsed.teammates) && parsed.teammates > 0, 'teammates must be a positive integer');

  return parsed;
}

main().catch((error) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
