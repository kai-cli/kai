/**
 * Atom store — markdown files are the SOLE source of truth (ARCHITECTURE.md §11 #2, #11).
 *
 * Format: YAML-ish frontmatter (HEAD) + a markdown body (DETAIL). We hand-serialize a small,
 * known field set rather than pulling a YAML dep — keeps the store human-diffable and the parser
 * defensive (Phase −1 finding F2: transcript/file schemas are irregular; parse must not throw on
 * shape surprises, only on genuinely invalid atoms).
 *
 * Writes are atomic: write to a temp file in the same dir, then rename (atomic on POSIX). This is
 * the MVP concurrency guard for parallel worktrees (§11 #8); a flock can be layered on later.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseAtom, type Atom, type LessonAtom } from "./schema.js";

const FM_DELIM = "---";

/** Serialize an atom to markdown: JSON frontmatter (lossless) + rendered body for humans. */
export function serializeAtom(atom: Atom): string {
  const fm = JSON.stringify(atom, null, 2);
  let body = "";
  if (atom.type === "lesson") {
    body = `\n# ${atom.claim.do}\n\nWHEN ${atom.claim.when}\nBECAUSE ${atom.claim.because}\n`;
    if (atom.detail) body += `\n## Detail\n${atom.detail}\n`;
  } else {
    body = `\n# Resume: ${atom.summary}\n\nNEXT: ${atom.next}\n`;
    if (atom.blockers.length) body += `\nBlockers:\n${atom.blockers.map((b) => `- ${b}`).join("\n")}\n`;
  }
  return `${FM_DELIM}\n${fm}\n${FM_DELIM}\n${body}`;
}

/** Parse markdown back to a validated atom. Frontmatter is the authoritative JSON. */
export function deserializeAtom(text: string): Atom {
  const start = text.indexOf(FM_DELIM);
  if (start !== 0) throw new Error("atom file must begin with frontmatter delimiter");
  const end = text.indexOf(`\n${FM_DELIM}`, FM_DELIM.length);
  if (end < 0) throw new Error("unterminated frontmatter");
  const fm = text.slice(FM_DELIM.length, end).trim();
  let obj: unknown;
  try {
    obj = JSON.parse(fm);
  } catch (e) {
    throw new Error(`frontmatter is not valid JSON: ${(e as Error).message}`);
  }
  return parseAtom(obj);
}

/** Compute the on-disk path for an atom: store/atoms/<scope-dir>/<type>/<id>.md */
export function atomPath(storeRoot: string, atom: Atom): string {
  const scopeParts =
    atom.scope === "global" ? ["global"] : ["project", atom.scope.slice("project:".length)];
  return join(storeRoot, "atoms", ...scopeParts, atom.type, `${atom.id}.md`);
}

/** Atomic write: temp file + rename in the same directory. */
export function writeAtom(storeRoot: string, atom: Atom): string {
  const path = atomPath(storeRoot, atom);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, serializeAtom(atom), "utf8");
  renameSync(tmp, path);
  return path;
}

export function readAtom(path: string): Atom {
  return deserializeAtom(readFileSync(path, "utf8"));
}

/** Walk the store and return every valid atom; skips files that fail to parse (logs to stderr). */
export function readAllAtoms(storeRoot: string): Atom[] {
  const atomsDir = join(storeRoot, "atoms");
  if (!existsSync(atomsDir)) return [];
  const out: Atom[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".md")) {
        try {
          out.push(readAtom(p));
        } catch (e) {
          process.stderr.write(`[store] skipping unparseable atom ${p}: ${(e as Error).message}\n`);
        }
      }
    }
  };
  walk(atomsDir);
  return out;
}

/**
 * Find a GLOBAL lesson atom by id (backflow refine target — spec 004 FR5). Returns undefined if no
 * atom with that id exists, or if it's not a global lesson (backflow is global-only; project atoms and
 * resume-states are not refine targets). Mirrors the CLI's findResume() shape.
 */
export function findLessonById(storeRoot: string, id: string): LessonAtom | undefined {
  return readAllAtoms(storeRoot).find(
    (a): a is LessonAtom => a.type === "lesson" && a.scope === "global" && a.id === id
  );
}
