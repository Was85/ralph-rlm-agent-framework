export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class TodoStore {
  private items = new Map<string, TodoItem>();
  private nextId = 1;

  add(title: string): TodoItem {
    const now = new Date();
    const item: TodoItem = {
      id: String(this.nextId++),
      title,
      completed: false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return item;
  }

  getAll(): TodoItem[] {
    return [...this.items.values()];
  }

  getById(id: string): TodoItem | undefined {
    return this.items.get(id);
  }

  update(id: string, fields: Partial<Pick<TodoItem, 'title' | 'completed'>>): TodoItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    if (fields.title !== undefined) item.title = fields.title;
    if (fields.completed !== undefined) item.completed = fields.completed;
    item.updatedAt = new Date();
    return item;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}
