import { describe, it, expect } from 'vitest';
import { TodoStore } from '../src/store';

describe('TodoStore', () => {
  it('add returns an item with all required fields', () => {
    const store = new TodoStore();
    const item = store.add('Buy groceries');

    expect(item.id).toBeDefined();
    expect(item.title).toBe('Buy groceries');
    expect(item.completed).toBe(false);
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it('getAll returns items in insertion order', () => {
    const store = new TodoStore();
    store.add('First');
    store.add('Second');
    store.add('Third');

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].title).toBe('First');
    expect(all[1].title).toBe('Second');
    expect(all[2].title).toBe('Third');
  });

  it('getById returns the correct item', () => {
    const store = new TodoStore();
    const added = store.add('Find me');

    const found = store.getById(added.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Find me');
  });

  it('getById returns undefined for unknown id', () => {
    const store = new TodoStore();
    expect(store.getById('nonexistent')).toBeUndefined();
  });
});
