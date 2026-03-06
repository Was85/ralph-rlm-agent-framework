import chalk from 'chalk';

export function teamBanner(teammates: number): void {
  console.log('');
  console.log(chalk.cyan('================================================================'));
  console.log(chalk.white('  Ralph-RLM Framework v3.0 — Team Mode'));
  console.log(chalk.white(`  ${teammates} parallel implementers`));
  console.log(chalk.cyan('================================================================'));
  console.log('');
}

export function phaseHeader(text: string): void {
  console.log('');
  console.log(chalk.cyan('----------------------------------------------------------------'));
  console.log(chalk.white(`  ${text}`));
  console.log(chalk.cyan('----------------------------------------------------------------'));
  console.log('');
}
