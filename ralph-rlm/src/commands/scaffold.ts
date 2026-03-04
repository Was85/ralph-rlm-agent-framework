import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from '../ui/logger.js';

function getScaffoldAssetsDir(): string {
  // Resolve relative to this file's location in the installed package
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', 'scaffold-assets');
}

export async function runScaffold(
  runner: 'claude' | 'copilot',
  cwd: string = process.cwd(),
): Promise<number> {
  logger.phase('SCAFFOLD PROJECT');
  logger.info(`Setting up Ralph framework files for ${runner}...`);

  const assetsDir = getScaffoldAssetsDir();

  if (!existsSync(assetsDir)) {
    logger.error(`Scaffold assets not found at: ${assetsDir}`);
    logger.info('This usually means the package was not installed correctly.');
    return 1;
  }

  let copied = 0;

  // Copy templates (feature_list.json template, prd.md template, validation-state.json)
  const templatesDir = path.join(assetsDir, 'templates');
  if (existsSync(templatesDir)) {
    const targetTemplates = path.join(cwd, 'templates');
    if (!existsSync(targetTemplates)) {
      await cp(templatesDir, targetTemplates, { recursive: true });
      logger.success('Copied templates/ (prd.md, feature_list.json, validation-state.json)');
      copied++;
    } else {
      logger.warning('templates/ already exists, skipping');
    }
  }

  if (runner === 'claude') {
    // Copy .claude/skills/ralph/ (SKILL.md files)
    const skillsSrc = path.join(assetsDir, 'claude', 'skills', 'ralph');
    const skillsDest = path.join(cwd, '.claude', 'skills', 'ralph');
    if (!existsSync(skillsDest)) {
      await mkdir(skillsDest, { recursive: true });
      await cp(skillsSrc, skillsDest, { recursive: true });
      logger.success('Copied .claude/skills/ralph/ (skill definitions)');
      copied++;
    } else {
      logger.warning('.claude/skills/ralph/ already exists, skipping');
    }

    // Copy .claude/rules/
    const rulesSrc = path.join(assetsDir, 'claude', 'rules');
    const rulesDest = path.join(cwd, '.claude', 'rules');
    if (!existsSync(rulesDest)) {
      await mkdir(rulesDest, { recursive: true });
      await cp(rulesSrc, rulesDest, { recursive: true });
      logger.success('Copied .claude/rules/ (coding standards)');
      copied++;
    } else {
      logger.warning('.claude/rules/ already exists, skipping');
    }

    // Copy .claude/settings.json
    const settingsSrc = path.join(assetsDir, 'claude', 'settings.json');
    const settingsDest = path.join(cwd, '.claude', 'settings.json');
    if (!existsSync(settingsDest) && existsSync(settingsSrc)) {
      await mkdir(path.join(cwd, '.claude'), { recursive: true });
      await cp(settingsSrc, settingsDest);
      logger.success('Copied .claude/settings.json');
      copied++;
    } else if (existsSync(settingsDest)) {
      logger.warning('.claude/settings.json already exists, skipping');
    }
  } else {
    // Copilot: copy .github/instructions/
    const copilotSrc = path.join(assetsDir, 'copilot');
    const copilotDest = path.join(cwd, '.github', 'instructions');
    if (existsSync(copilotSrc) && !existsSync(copilotDest)) {
      await mkdir(copilotDest, { recursive: true });
      await cp(copilotSrc, copilotDest, { recursive: true });
      logger.success('Copied .github/instructions/ (coding standards)');
      copied++;
    }
  }

  // Create empty prd.md if it doesn't exist
  const prdPath = path.join(cwd, 'prd.md');
  if (!existsSync(prdPath)) {
    const templatePrd = path.join(assetsDir, 'templates', 'prd.md');
    if (existsSync(templatePrd)) {
      await cp(templatePrd, prdPath);
      logger.success('Created prd.md from template');
      copied++;
    } else {
      await writeFile(prdPath, '# Product Requirements Document\n\n## Project Overview\n\n## Functional Requirements\n\n## Non-Functional Requirements\n', 'utf-8');
      logger.success('Created empty prd.md');
      copied++;
    }
  } else {
    logger.warning('prd.md already exists, skipping');
  }

  if (copied === 0) {
    logger.info('Nothing to scaffold — all files already exist.');
  } else {
    logger.success(`Scaffolded ${copied} items.`);
    logger.info('Next steps:');
    logger.info('  1. Edit prd.md with your requirements');
    logger.info('  2. Run: ralph auto');
  }

  return 0;
}
