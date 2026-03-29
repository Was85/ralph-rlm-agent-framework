import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('GET /health returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /health returns JSON health status', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ status: 'healthy' });
  });
});
