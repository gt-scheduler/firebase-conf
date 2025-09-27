import { MetricName, TargetType, SubmitMetricsRequestData } from "./types";

export function validateMetricData(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as SubmitMetricsRequestData;

  if (!Object.values(MetricName).includes(d.metricName)) return false;
  if (!Array.isArray(d.targets)) return false;

  for (const target of d.targets) {
    if (typeof target !== "object" || target === null) return false;
    if (!Object.values(TargetType).includes(target.type)) return false;
    if (typeof target.reference !== "string") return false;

    switch (target.type) {
      case TargetType.COURSE: {
        // ABCD 1234
        if (!/^[A-Z]+ \d{4}$/.test(target.reference)) return false;
        break;
      }

      case TargetType.PROFESSOR: {
        // FirstName LastName
        const nameParts = target.reference.split(" ");
        if (nameParts.length !== 2) return false;
        break;
      }

      case TargetType.SECTION: {
        // ABC01
        if (!/^[A-Z]+\d+$/.test(target.reference)) return false;
        break;
      }

      default: {
        break;
      }
    }
  }

  // YYYYMM
  if (d.semester !== undefined) {
    if (typeof d.semester !== "number") return false;
    if (!/^\d{6}$/.test(String(d.semester))) return false;
  }

  return true;
}
