// Content bundled at build time by scripts/gen-content.mjs from content/ (with test/fixtures/content as fallback).
import data from './generated/content.json';
import type { Lang } from '../shared/protocol';

type Bucket = Record<string, Record<string, unknown[]>>;
const packs = (data as { packs: Bucket }).packs;
const trivia = (data as { trivia: Bucket }).trivia;

export function getPack<T = unknown>(lang: Lang, name: string): T[] {
  return (packs[lang]?.[name] ?? []) as T[];
}

export function getTrivia<T = unknown>(lang: Lang, topic: string): T[] {
  return (trivia[lang]?.[topic] ?? []) as T[];
}

/** Which source each bucket came from ("content" or "fixture"). Handy for debugging. */
export const contentSources = (data as { sources: Record<string, string> }).sources;
