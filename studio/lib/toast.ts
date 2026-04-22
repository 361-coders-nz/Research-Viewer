"use client";

import { nanoid } from "nanoid";

export type Toast = {
  id: string;
  message: string;
  tone?: "info" | "success" | "error";
  durationMs?: number;
};

type Listener = (toasts: Toast[]) => void;

class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.toasts);
    return () => {
      this.listeners.delete(fn);
    };
  }

  push(t: Omit<Toast, "id">): string {
    const id = nanoid(8);
    const next: Toast = { id, durationMs: 3200, tone: "info", ...t };
    this.toasts = [...this.toasts, next];
    this.emit();
    if (next.durationMs && next.durationMs > 0) {
      setTimeout(() => this.dismiss(id), next.durationMs);
    }
    return id;
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.toasts);
  }
}

export const toastStore = new ToastStore();

export function toast(message: string, tone: Toast["tone"] = "info", durationMs?: number) {
  return toastStore.push({ message, tone, durationMs });
}
