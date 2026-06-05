/**
 * Duplicates report — the SAFE transfer slice (ARCHITECTURE.md §5, §11 #5).
 *
 * NO auto-merge, NO auto-promote (those are the deferred, dangerous P3). This is a read-only report:
 * find lesson pairs that look like the same lesson living in two scopes (the proven duplicate-file
 * problem) and SUGGEST a human one-click merge to global. Jaccard token overlap — no embeddings dep.
 */
import { tokenize } from "./recall.js";
import { renderClaim, type Atom, type LessonAtom } from "./schema.js";

export interface DuplicatePair {
  a: { id: string; scope: string; claim: string };
  b: { id: string; scope: string; claim: string };
  similarity: number;
  suggestion: string;
}

function lessonTokens(l: LessonAtom): Set<string> {
  return new Set([
    ...tokenize(l.claim.when),
    ...tokenize(l.claim.do),
    ...tokenize(l.claim.because),
    ...l.trigger.flatMap(tokenize),
  ]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Find likely-duplicate lesson pairs above `threshold` similarity. Read-only. */
export function findDuplicates(atoms: Atom[], threshold = 0.6): DuplicatePair[] {
  const lessons = atoms.filter((a): a is LessonAtom => a.type === "lesson");
  const tokenSets = lessons.map(lessonTokens);
  const out: DuplicatePair[] = [];

  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const sim = jaccard(tokenSets[i]!, tokenSets[j]!);
      if (sim < threshold) continue;
      const li = lessons[i]!;
      const lj = lessons[j]!;
      const bothProject = li.scope.startsWith("project:") && lj.scope.startsWith("project:") && li.scope !== lj.scope;
      const suggestion = bothProject
        ? `Same lesson in ${li.scope} and ${lj.scope} — promote ONE to scope:global, delete the other.`
        : `High overlap — consider merging (keep the higher-confidence / more-used atom).`;
      out.push({
        a: { id: li.id, scope: li.scope, claim: renderClaim(li.claim) },
        b: { id: lj.id, scope: lj.scope, claim: renderClaim(lj.claim) },
        similarity: Math.round(sim * 100) / 100,
        suggestion,
      });
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
