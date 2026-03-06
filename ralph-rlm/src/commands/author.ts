import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RalphConfig, Runner } from '../config/types.js';
import { checkGit, checkCli } from '../core/preflight.js';
import * as logger from '../ui/logger.js';

export async function runAuthor(
  config: RalphConfig,
  skillsDir: string,
  runner: Runner,
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('PRD AUTHOR');
  logger.info('Interactive PRD creation assistant...');

  // Basic preflight (git + CLI only)
  if (!(await checkGit(cwd))) return 1;
  if (!(await checkCli(config.runner))) return 1;

  // Check PRD Author skill
  const skillFile = path.join(skillsDir, 'ralph', 'prd-author', 'SKILL.md');
  if (!existsSync(skillFile)) {
    logger.error(`PRD Author skill not found at: ${skillFile}`);
    return 1;
  }
  logger.success('PRD Author skill found');

  const prompt = `Your task instructions are in the file: ${skillFile} — start by using your Read tool to open that file, then follow every instruction in it. You are helping the user create a prd.md for Ralph-RLM-Framework. If a prd.md template exists at templates/prd.md, use it as the output structure. Guide the user through each phase described in the skill file. Save the final result as prd.md in the current directory. Begin with Phase 1: Project Understanding by asking the user about their project.`;

  logger.info('Running PRD Author assistant...');
  logger.info('This will guide you through creating a high-quality prd.md');

  await runner.invoke(prompt, {
    verbose: config.verbose,
    debug: config.debug,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
    stream: config.stream,
  });

  if (existsSync(path.join(cwd, 'prd.md'))) {
    logger.success('prd.md created successfully!');
    logger.info('Next steps: 1. Review prd.md  2. Run: ralph auto');
    return 0;
  } else {
    logger.warning('prd.md was not created. You can create it manually using templates/prd.md');
    return 1;
  }
}
