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

export function debugLog(msg: string, verbose: boolean): void {
  if (verbose) {
    console.log(chalk.gray(`[DEBUG] ${msg}`));
  }
}
