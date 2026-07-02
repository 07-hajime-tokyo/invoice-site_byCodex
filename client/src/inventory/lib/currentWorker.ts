const CURRENT_WORK_WORKER_KEY = "inventory_current_work_worker_name";

export function getCurrentWorkWorkerName(fallback?: string | null) {
  const fallbackName = fallback?.trim() ?? "";
  if (typeof window === "undefined") return fallbackName;

  const storedName = window.localStorage.getItem(CURRENT_WORK_WORKER_KEY)?.trim() ?? "";
  return storedName || fallbackName;
}

export function setCurrentWorkWorkerName(workerName: string) {
  const trimmedName = workerName.trim();
  if (typeof window === "undefined" || !trimmedName) return;

  window.localStorage.setItem(CURRENT_WORK_WORKER_KEY, trimmedName);
}
