import { api } from "../lib/api";

export type TaskOwner = "team" | "candidate";
export type TaskStatus = "todo" | "blocked" | "done";
export interface JoiningTaskDraft { title: string; instructions: string; owner: TaskOwner; due_date: string | null }
export interface JoiningTask extends JoiningTaskDraft {
  id: string; revision: number; status: TaskStatus; created_at: string;
  history: Array<{ id: string; status: TaskStatus; note: string; by: TaskOwner; created_at: string }>;
}
export interface JoiningPlan {
  id: string; introduction: string; start_date: string; created_at: string; revision: number;
  tasks: JoiningTask[]; completed: number; blocked: number;
}
export interface JoiningState { plan: JoiningPlan | null; eligible: boolean; accepting: boolean }
export const handoffApi = {
  get: (base: string) => api.call<JoiningState>(`${base}/handoff`),
  write: (base: string, action: string, body: object) => api.call<JoiningState>(
    `${base}/handoff${action ? `/${action}` : ""}`, { method: "POST", body: JSON.stringify(body) }),
};

export const joiningTasks = (): JoiningTaskDraft[] => [
  { title: "Arrange the formal agreement", instructions: "Agree the formal contract and signing process with the candidate. Mark complete only after your team has arranged it.", owner: "team", due_date: null },
  { title: "Review the joining arrangements", instructions: "Review your formal agreement and first-day arrangements with the team. Ask about anything that is unclear before marking this complete.", owner: "candidate", due_date: null },
  { title: "Prepare equipment and access", instructions: "Arrange the equipment, access and first-day contact. Share instructions here without including passwords or private access tokens.", owner: "team", due_date: null },
];
