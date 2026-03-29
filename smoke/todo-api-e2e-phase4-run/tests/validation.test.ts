import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('POST /todos rejects missing title', () => {
  it('returns 400 when title is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/todos').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title is required' });
  });

  it('returns 400 when title is null', async () => {
    const app = createApp();
    const res = await request(app).post('/todos').send({ title: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title is required' });
  });

  it('returns 400 when title is blank', async () => {
    const app = createApp();
    const res = await request(app).post('/todos').send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title must be a non-empty string' });
  });

  it('returns 400 when title is empty string', async () => {
    const app = createApp();
    const res = await request(app).post('/todos').send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title must be a non-empty string' });
  });

  it('returns 400 when title is a number', async () => {
    const app = createApp();
    const res = await request(app).post('/todos').send({ title: 123 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title must be a non-empty string' });
  });
});

describe('PATCH /todos/:id rejects invalid payload', () => {
  it('returns 400 when title is empty string', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Valid' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title must be a non-empty string' });
  });

  it('returns 400 when title is whitespace only', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Valid' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Title must be a non-empty string' });
  });

  it('returns 400 when completed is a string', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Valid' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ completed: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Completed must be a boolean' });
  });

  it('returns 400 when completed is a number', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Valid' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ completed: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Completed must be a boolean' });
  });

  it('allows valid partial update with only title', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Original' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ title: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
  });

  it('allows valid partial update with only completed', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Original' });
    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });
});
