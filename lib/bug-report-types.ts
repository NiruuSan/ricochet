export const BUG_REPORT_LIMITS = { title: 120, description: 6000, links: 5, url: 2048 } as const;
export type BugReportStatus = "open" | "resolved";
export type BugReport = {
  id: string;
  reporter: string | null;
  title: string;
  description: string;
  links: string[];
  page: string;
  status: BugReportStatus;
  created: number;
  updated: number;
};
export type BugReportPage = { reports: BugReport[]; total: number; offset: number; limit: number };
