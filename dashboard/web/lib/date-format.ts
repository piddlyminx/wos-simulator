const DASHBOARD_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "short",
  timeStyle: "medium",
  hour12: false,
  timeZone: "Europe/London",
});

export function formatDashboardDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return DASHBOARD_DATE_TIME_FORMAT.format(new Date(iso));
  } catch {
    return iso;
  }
}
