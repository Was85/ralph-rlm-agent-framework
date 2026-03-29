import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('POST /todos', () => {
  it('POST /todos creates an item', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/todos')
      .send({ title: 'Buy milk' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Buy milk',
      completed: false,
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.updatedAt).toBeDefined();
  });
});

describe('GET /todos', () => {
  it('GET /todos returns all items', async () => {
    const app = createApp();
    await request(app).post('/todos').send({ title: 'First' });
    await request(app).post('/todos').send({ title: 'Second' });

    const res = await request(app).get('/todos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('First');
    expect(res.body[1].title).toBe('Second');
  });
});

describe('PATCH /todos/:id', () => {
  it('PATCH /todos/:id updates the item', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Original' });
    const originalUpdatedAt = created.body.updatedAt;

    const res = await request(app)
      .patch(`/todos/${created.body.id}`)
      .send({ title: 'Updated', completed: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.body.id,
      title: 'Updated',
      completed: true,
    });
    expect(res.body.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('PATCH /todos/:id returns 404 for unknown id', async () => {
    const app = createApp();

    const res = await request(app)
      .patch('/todos/999')
      .send({ title: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Todo not found' });
  });
});

describe('DELETE /todos/:id', () => {
  it('DELETE /todos/:id removes the item', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'To delete' });

    const res = await request(app).delete(`/todos/${created.body.id}`);
    expect(res.status).toBe(204);

    const list = await request(app).get('/todos');
    expect(list.body).toHaveLength(0);
  });

  it('DELETE /todos/:id returns 404 for unknown id', async () => {
    const app = createApp();

    const res = await request(app).delete('/todos/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Todo not found' });
  });
});

describe('GET /todos/:id', () => {
  it('GET /todos/:id returns the item', async () => {
    const app = createApp();
    const created = await request(app).post('/todos').send({ title: 'Test item' });

    const res = await request(app).get(`/todos/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.body.id,
      title: 'Test item',
      completed: false,
    });
  });

  it('GET /todos/:id returns 404 for unknown id', async () => {
    const app = createApp();

    const res = await request(app).get('/todos/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Todo not found' });
  });
});
