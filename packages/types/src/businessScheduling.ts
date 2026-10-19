export interface BizAvailabilityWindow { start: string; end: string }
export interface BizTimeRequest {
  id: string; revision: number; interview_id: string; timezone: string;
  windows: BizAvailabilityWindow[]; reason: string; status: string; created_at: string;
  reply: { message: string; slots: string[]; created_at: string } | null;
}
export interface BizScheduling {
  requests: BizTimeRequest[]; accepting: boolean;
  interview: { id: string; revision: number; chosen: string | null; duration_min: number } | null;
}
export interface BizSchedulingReply {
  request_id: string; base_revision: number; interview_revision: number; message: string;
  slots: string[]; notify: boolean;
}
