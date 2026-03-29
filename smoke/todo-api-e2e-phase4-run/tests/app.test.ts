import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';

describe('app', () => {
  it('boots without error', () => {
    const app = createApp();
    expect(app).toBeDefined();
  });
});
