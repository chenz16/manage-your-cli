export interface JobRow {
  id: string;
  staff_id: string;
  brief: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  deliverable_id?: string;
  error?: string;
}

export interface JobsApiResponse {
  items: JobRow[];
  dispatcher?: { running: boolean; currentJobId: string | null };
}
