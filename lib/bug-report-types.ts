export const BUG_REPORT_LIMITS = { title: 120, description: 6000, links: 5, url: 2048 } as const;
export const BUG_ATTACHMENT_LIMITS = { count: 5, bytes: 25 * 1024 * 1024, name: 180 } as const;
export const BUG_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime"];
export type BugAttachment = { id: string; name: string; type: string; size: number };
export type BugReportStatus = "open" | "resolved";
export type BugReport = {
  id: string;
  reporter: string | null;
  title: string;
  description: string;
  links: string[];
  attachments: BugAttachment[];
  page: string;
  status: BugReportStatus;
  created: number;
  updated: number;
};
export type BugReportPage = { reports: BugReport[]; total: number; offset: number; limit: number };
