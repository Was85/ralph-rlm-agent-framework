import chalk from 'chalk';

export function success(msg: string): void {
  console.log(chalk.green(`[+] ${msg}`));
}

export function error(msg: string): void {
  console.log(chalk.red(`[x] ${msg}`));
}

export function warning(msg: string): void {
  console.log(chalk.yellow(`[!] ${msg}`));
}

export function info(msg: string): void {
  console.log(chalk.blue(`[i] ${msg}`));
}

export function phase(text: string): void {
  console.log('');
  console.log(chalk.cyan('----------------------------------------------------------------'));
  console.log(chalk.white(`  ${text}`));
  console.log(chalk.cyan('----------------------------------------------------------------'));
  console.log('');
}

export function banner(): void {
  console.log('');
  console.log(chalk.cyan('================================================================'));
  console.log(chalk.white('  Ralph-RLM Framework v3.0'));
  console.log(chalk.white('  AI-Driven Autonomous Development Orchestrator'));
  console.log(chalk.cyan('================================================================'));
  console.log('');
}

export function feature(id: string, description: string, progress: { complete: number; total: number; attempt?: number }): void {
  console.log('');
  console.log(chalk.cyan('────────────────────────────────────────────────────'));
  console.log(chalk.white(`  Working on: ${chalk.bold(id)} — ${description}`));
  console.log(chalk.gray(`  Progress:   ${progress.complete}/${progress.total} features complete${progress.attempt && progress.attempt > 1 ? ` (attempt ${progress.attempt})` : ''}`));
  console.log(chalk.cyan('────────────────────────────────────────────────────'));
  console.log('');
}

export function teamLevel(level: number, featureIds: string[]): void {
  console.log('');
  console.log(chalk.cyan('════════════════════════════════════════════════════'));
  console.log(chalk.white(`  Level ${level}: ${featureIds.join(', ')}`));
  console.log(chalk.gray(`  Dispatching ${featureIds.length} agent(s) in parallel`));
  console.log(chalk.cyan('════════════════════════════════════════════════════'));
  console.log('');
}

export function teamMerge(featureId: string, success: boolean): void {
  if (success) {
    console.log(chalk.green(`  [merge] ${featureId} — merged successfully`));
  } else {
    console.log(chalk.yellow(`  [merge] ${featureId} — merge failed`));
  }
}

export function debugLog(msg: string, verbose: boolean): void {
  if (verbose) {
    console.log(chalk.gray(`[DEBUG] ${msg}`));
  }
}
