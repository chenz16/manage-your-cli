import { z } from 'zod';

/**
 * Todo — boss backlog item. V1 design: pending = 待分配 (default),
 * delegated = 派出去了, done = 完成. No complex lifecycle needed for V1.
 */

export const TodoStatus = z.enum(['pending', 'delegated', 'done']);
export type TodoStatus = z.infer<typeof TodoStatus>;

export const TodoPriority = z.enum(['high', 'medium', 'low']);
export type TodoPriority = z.infer<typeof TodoPriority>;

export const Todo = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: TodoStatus,
  priority: TodoPriority.default('medium'),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Todo = z.infer<typeof Todo>;

export const AddTodoBody = z.object({
  text: z.string().min(1),
  priority: TodoPriority.optional(),
});
export type AddTodoBody = z.infer<typeof AddTodoBody>;

export const UpdateTodoBody = z.object({
  text: z.string().min(1).optional(),
  status: TodoStatus.optional(),
  priority: TodoPriority.optional(),
});
export type UpdateTodoBody = z.infer<typeof UpdateTodoBody>;

export const ListTodosResponse = z.object({
  items: z.array(Todo),
});
export type ListTodosResponse = z.infer<typeof ListTodosResponse>;
