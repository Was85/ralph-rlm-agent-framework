import { readFileSync } from 'node:fs';
import path from 'node:path';

// Self-heal contract: every agent prompt that consumes assignment.json and
// whose output the framework gates MUST tell the agent that a non-null
// assignment.last_error means "this is a retry — resolve that exact prior
// failure". Without this, retries repeat the same mistake and the feature
// loops to "blocked" even when the work is correct (observed on F001).
describe('prompt self-heal directive', () => {
  const promptsDir = path.join(__dirname, '..', '..', 'prompts');

  for (const file of ['feature-planner.md', 'implementer.md', 'evaluator.md']) {
    it(`${file} instructs the agent to resolve assignment.last_error on retry`, () => {
      const text = readFileSync(path.join(promptsDir, file), 'utf-8').toLowerCase();

      expect(text).toContain('last_error');
      expect(text).toContain('previous attempt');
    });
  }
});
