"use client";

import { nanoid } from "nanoid";
import { pickUserColor } from "./liveblocks";

const STORAGE_KEY = "oxflow-studio:user";

export type StudioUser = {
  id: string;
  name: string;
  color: string;
};

export function getOrCreateUser(): StudioUser {
  if (typeof window === "undefined") {
    return { id: "anon", name: "Anonymous", color: "#10B981" };
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as StudioUser;
    } catch {
      /* fall through */
    }
  }
  const next: StudioUser = {
    id: nanoid(10),
    name: defaultName(),
    color: pickUserColor(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updateUserName(name: string): StudioUser {
  const user = getOrCreateUser();
  user.name = name || user.name;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

function defaultName() {
  const animals = ["otter", "kea", "finch", "heron", "weka", "tui", "lark", "crane"];
  const adjectives = ["quiet", "bright", "calm", "spry", "wry", "keen", "crisp"];
  return `${pick(adjectives)}-${pick(animals)}`;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
