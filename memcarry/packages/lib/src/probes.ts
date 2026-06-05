/**
 * Probe layer — verify-at-load against live reality. THE riskiest code (ARCHITECTURE.md §11 #3,9,10,18).
 *
 * Non-negotiable contracts encoded here:
 *  - 3-STATE result: VERIFIED | DRIFTED | INDETERMINATE(reason). Never collapse INDETERMINATE into
 *    DRIFTED — a transient/ambiguous signal must NOT trigger a confident next-step rewrite (§11 #16).
 *  - NO shell interpolation: every probe uses execFile with an argv array. Atom fields are validated
 *    against typed patterns BEFORE becoming arguments (§11 #18). Treat atoms as untrusted input.
 *  - Explicit -C <repo_path> / --repo — never rely on cwd (§11 #10).
 *  - Per-probe hard timeout; JS-level (AbortController), since macOS has no GNU `timeout` (§9).
 *  - Unknown failure signatures → INDETERMINATE(snippet), never DRIFTED (catch-all, §11 #10).
 */
import { execFile } from "node:child_process";

export type ProbeState = "verified" | "drifted" | "indeterminate";
export interface ProbeResult {
  state: ProbeState;
  observed?: string;
  reason?: string;
}

const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,255}$/;
const SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const PR_RE = /^\d{1,7}$/;
const HOST_RE = /^[A-Za-z0-9.\-:]{1,255}$/;

interface ExecOut {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Safe exec: argv only, hard timeout, never throws — returns a structured result. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<ExecOut> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        const timedOut = !!(err && (err as any).killed && (err as any).signal === "SIGKILL");
        resolve({
          code: err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          timedOut,
        });
      }
    );
    child.on("error", () => resolve({ code: 1, stdout: "", stderr: "spawn error", timedOut: false }));
  });
}

const snippet = (s: string) => s.trim().split("\n")[0]?.slice(0, 160) ?? "";

/** git-branch: does `repo_path` currently sit on the recorded branch? */
export async function probeGitBranch(
  repoPath: string,
  recordedBranch: string,
  timeoutMs = 200
): Promise<ProbeResult> {
  if (!BRANCH_RE.test(recordedBranch))
    return { state: "indeterminate", reason: "recorded branch fails validation" };
  const r = await run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], timeoutMs);
  if (r.timedOut) return { state: "indeterminate", reason: "git timed out" };
  if (r.code !== 0) {
    // wrong-cwd / not-a-repo / detached — all INDETERMINATE, never DRIFTED
    return { state: "indeterminate", reason: snippet(r.stderr) || "git failed" };
  }
  const current = r.stdout.trim();
  if (current === "HEAD") return { state: "indeterminate", reason: "detached HEAD" };
  return current === recordedBranch
    ? { state: "verified", observed: current }
    : { state: "drifted", observed: current };
}

/** gh-pr: is PR <num> in <slug> still in the recorded state? */
export async function probeGhPr(
  slug: string,
  prNum: string,
  recordedState: string,
  timeoutMs = 1500
): Promise<ProbeResult> {
  if (!SLUG_RE.test(slug)) return { state: "indeterminate", reason: "repo slug fails validation" };
  if (!PR_RE.test(prNum)) return { state: "indeterminate", reason: "pr number fails validation" };
  const r = await run("gh", ["pr", "view", prNum, "--repo", slug, "--json", "state", "-q", ".state"], timeoutMs);
  if (r.timedOut) return { state: "indeterminate", reason: "gh timed out" };
  if (r.code !== 0) {
    const s = (r.stderr + r.stdout).toLowerCase();
    // map known gh failures to INDETERMINATE (auth/rate-limit/network), never DRIFTED
    if (s.includes("auth") || s.includes("login") || s.includes("rate limit") || s.includes("could not resolve"))
      return { state: "indeterminate", reason: "gh unauthed/ratelimited/offline" };
    return { state: "indeterminate", reason: snippet(r.stderr) || "gh failed" };
  }
  const observed = r.stdout.trim().toLowerCase();
  return observed === recordedState.toLowerCase()
    ? { state: "verified", observed }
    : { state: "drifted", observed };
}

/** ping: is a host reachable? (device cursor) — offline is INDETERMINATE, not DRIFTED. */
export async function probePing(host: string, timeoutMs = 500): Promise<ProbeResult> {
  if (!HOST_RE.test(host)) return { state: "indeterminate", reason: "host fails validation" };
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const r = await run("ping", ["-c", "1", "-W", String(secs), host.split(":")[0]!], timeoutMs + 200);
  if (r.timedOut) return { state: "indeterminate", reason: "ping timed out" };
  return r.code === 0
    ? { state: "verified", observed: "reachable" }
    : { state: "indeterminate", reason: "unreachable (may be powered off)" };
}

/** ssh: can we open a batch (non-interactive) connection? host-key-changed → INDETERMINATE. */
export async function probeSsh(host: string, timeoutMs = 1500): Promise<ProbeResult> {
  if (!HOST_RE.test(host)) return { state: "indeterminate", reason: "host fails validation" };
  const r = await run(
    "ssh",
    [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
      host, "true",
    ],
    timeoutMs + 300
  );
  if (r.timedOut) return { state: "indeterminate", reason: "ssh timed out" };
  if (r.code === 0) return { state: "verified", observed: "reachable" };
  const s = r.stderr.toLowerCase();
  if (s.includes("host key") || s.includes("remote host identification"))
    return { state: "indeterminate", reason: "ssh host key changed (likely reflash)" };
  return { state: "indeterminate", reason: snippet(r.stderr) || "ssh failed" };
}
