import { teamBanner, phaseHeader } from '../../src/ui/banner.js';

describe('banner', () => {
  let output: string[];
  const originalLog = console.log;

  beforeEach(() => {
    output = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe('teamBanner', () => {
    it('prints banner with teammate count', () => {
      teamBanner(3);
      const text = output.join('\n');
      expect(text).toContain('Ralph-RLM Framework');
      expect(text).toContain('3');
    });

    it('prints banner with custom teammate count', () => {
      teamBanner(5);
      const text = output.join('\n');
      expect(text).toContain('5');
    });
  });

  describe('phaseHeader', () => {
    it('prints phase name', () => {
      phaseHeader('PHASE 3: IMPLEMENT');
      const text = output.join('\n');
      expect(text).toContain('PHASE 3: IMPLEMENT');
    });
  });
});
