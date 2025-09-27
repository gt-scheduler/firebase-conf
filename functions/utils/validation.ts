import { MetricName, TargetType } from "./types";

export function validateMetricData(data: any): boolean {
  if (!data || typeof data !== "object") return false;

  if (!Object.values(MetricName).includes(data.metric_name)) return false;

  if (!Array.isArray(data.targets)) return false;

  for (const target of data.targets) {
    if (!target || typeof target !== "object") return false;
    if (!Object.values(TargetType).includes(target.type)) return false;
    if (typeof target.reference !== "string") return false;

    switch (target.type) {
      case TargetType.COURSE:
        // ABC1234
        if (!/^[A-Z]+\d{4}$/.test(target.reference)) return false;
        break;

      case TargetType.PROFESSOR:
        // FirstName LastName
        const nameParts = target.reference.split(" ");
        if (nameParts.length !== 2) return false;
        break;

      case TargetType.SECTION:
        // ABC01
        if (!/^[A-Z]+\d+$/.test(target.reference)) return false;
        break;
    }
  }

  // YYYYMM
  if (data.semester !== undefined) {
    if (typeof data.semester !== "number") return false;
    if (!/^\d{6}$/.test(String(data.semester))) return false;
  }

  return true;
}
