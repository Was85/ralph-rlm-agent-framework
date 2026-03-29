import express, { Application } from 'express';
import { TodoStore } from './store';
import { createTodosRouter } from './routes/todos';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  const store = new TodoStore();
  app.use('/todos', createTodosRouter(store));

  return app;
}
