import { Router } from 'express';
import { TodoStore } from '../store';

export function createTodosRouter(store: TodoStore): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const { title } = req.body;
    if (title === undefined || title === null) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'Title must be a non-empty string' });
      return;
    }
    const item = store.add(title);
    res.status(201).json(item);
  });

  router.get('/', (_req, res) => {
    res.json(store.getAll());
  });

  router.get('/:id', (req, res) => {
    const item = store.getById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.json(item);
  });


  router.patch('/:id', (req, res) => {
    const { title, completed } = req.body;
    if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
      res.status(400).json({ error: 'Title must be a non-empty string' });
      return;
    }
    if (completed !== undefined && typeof completed !== 'boolean') {
      res.status(400).json({ error: 'Completed must be a boolean' });
      return;
    }
    const updated = store.update(req.params.id, { title, completed });
    if (!updated) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const deleted = store.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
