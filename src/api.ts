import type { Resource } from "../shared/types";
export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || "Não foi possível conectar ao servidor."), { status: res.status });
  }
  return res.json();
}
export const post = <T = any>(url: string, data: any = {}) => api<T>(url, { method: "POST", body: JSON.stringify(data) });
export async function upload(file: File) {
  const body = new FormData();
  body.append("file", file);
  return api("/upload", { method: "POST", body });
}
export function download(url: string) {
  const a = document.createElement("a");
  a.href = `/api${url}`;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
}
export function formatDate(date: string) {
  return new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
export const create = (kind: Resource["kind"], name: string, parentId: string | null, data: any) =>
  post<Resource>("/resources", { kind, name, parentId, data });
export const bytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
