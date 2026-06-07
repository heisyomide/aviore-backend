// src/users/interfaces/completion.interface.ts

export type TaskId = 
  | 'customer-profile'
  | 'customer-address'
  | 'first-order-guidance'
  | 'vendor-slug'
  | 'vendor-bank'
  | 'vendor-description';

export interface CompletionTask {
  id: TaskId;
  title: string;
  description?: string;
  completed: boolean;
  route: string;
  progress?: number;
  target?: number;
}

export interface CompletionEngineResponse {
  completionPercentage: number;
  isFullyActive: boolean;
  tasks: CompletionTask[];
}