import express, { Application } from 'express';

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  return app;
}
