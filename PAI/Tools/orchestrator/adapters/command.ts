import { spawn, type ChildProcess } from 'child_process';
import {
  type AgentCapability,
  type AgentResult,
  type WorkArtifact,
  type WorkPacket,
  type WorkRoleName,
  validateAgentResult,
} from '../schema';

export interface CommandAdapterConfig {
  id: string;
  engine: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  envAllowlist?: string[];
  env?: Record<string, string>;
  requireStructuredOutput?: boolean;
  supportedRoles?: WorkRoleName[];
  supportedCapabilities?: AgentCapability[];
}

export interface CommandAdapterRun {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  envKeys: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_KILL_GRACE_MS = 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_ENV_ALLOWLIST = ['HOME', 'PATH', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL'];

function nowIso(): string {
  return new Date().toISOString();
}

function commandOutputArtifact(
  packet: WorkPacket,
  config: CommandAdapterConfig,
  content: string,
  metadata: Record<string, unknown>,
): WorkArtifact {
  return {
    id: `${packet.id}-${config.id}-command-output`,
    type: 'agent-result',
    source: config.engine,
    createdAt: nowIso(),
    content,
    metadata,
  };
}

function result(
  status: AgentResult['status'],
  summary: string,
  artifact: WorkArtifact,
): AgentResult {
  return { status, summary, artifacts: [artifact] };
}

function blocked(packet: WorkPacket, config: CommandAdapterConfig, summary: string, metadata: Record<string, unknown>): AgentResult {
  return result('blocked', summary, commandOutputArtifact(packet, config, '', metadata));
}

function renderTemplate(value: string, packet: WorkPacket): string {
  const prompt = structuredPrompt(packet);
  const replacements: Record<string, string> = {
    '{{packet_json}}': JSON.stringify(packet),
    '{{prompt}}': prompt,
    '{{packet.id}}': packet.id,
    '{{packet.workItemId}}': packet.workItemId,
    '{{packet.type}}': packet.type,
    '{{packet.role.role}}': packet.role.role,
    '{{packet.role.engine}}': packet.role.engine,
  };
  return Object.entries(replacements).reduce((rendered, [token, replacement]) => rendered.replaceAll(token, replacement), value);
}

function buildEnv(config: CommandAdapterConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of config.envAllowlist ?? DEFAULT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...(config.env ?? {}) };
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process may have already exited between timeout and cleanup.
    }
  }
}

function supportsPacket(packet: WorkPacket, config: CommandAdapterConfig): string | null {
  if (packet.role.engine !== config.engine) {
    return `Packet role engine ${packet.role.engine} does not match adapter ${config.engine}.`;
  }
  if (config.supportedRoles && !config.supportedRoles.includes(packet.role.role)) {
    return `Role ${packet.role.role} is not supported by adapter ${config.engine}.`;
  }
  const supportedCapabilities = config.supportedCapabilities;
  if (supportedCapabilities) {
    const unsupported = packet.role.capabilities.find((capability) => !supportedCapabilities.includes(capability));
    if (unsupported) return `Capability ${unsupported} is not supported by adapter ${config.engine}.`;
  }
  return null;
}

export function structuredPrompt(packet: WorkPacket): string {
  return [
    'You are running as a PAI orchestration agent.',
    'Return ONLY JSON matching this AgentResult shape:',
    '{"status":"pass|findings|fixed|blocked|error","summary":"string","artifacts":[],"findings":[]}',
    'Do not include markdown fences or prose outside the JSON object.',
    '',
    'Work packet:',
    JSON.stringify(packet, null, 2),
  ].join('\n');
}

export function describeCommandRun(packet: WorkPacket, config: CommandAdapterConfig): CommandAdapterRun {
  const args = (config.args ?? []).map((arg) => renderTemplate(arg, packet));
  const env = buildEnv(config);
  return {
    command: renderTemplate(config.command, packet),
    args,
    cwd: config.cwd ? renderTemplate(config.cwd, packet) : undefined,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    envKeys: Object.keys(env).sort(),
  };
}

export async function runCommandAdapter(packet: WorkPacket, config: CommandAdapterConfig): Promise<AgentResult> {
  const unsupported = supportsPacket(packet, config);
  if (unsupported) {
    return blocked(packet, config, unsupported, { blocked: true, reason: unsupported });
  }

  const command = renderTemplate(config.command, packet);
  const args = (config.args ?? []).map((arg) => renderTemplate(arg, packet));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = config.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();
  const env = buildEnv(config);

  return await new Promise<AgentResult>((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(command, args, {
      cwd: config.cwd ? renderTemplate(config.cwd, packet) : undefined,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    const finish = (agentResult: AgentResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(agentResult);
    };

    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL');
      }, killGraceMs);
    }, timeoutMs);

    const appendOutput = (stream: 'stdout' | 'stderr', chunk: string): void => {
      if (outputExceeded) return;
      const bytes = Buffer.byteLength(chunk, 'utf8');
      const currentTotal = stdoutBytes + stderrBytes;
      if (currentTotal + bytes > maxOutputBytes) {
        outputExceeded = true;
        const remaining = Math.max(0, maxOutputBytes - currentTotal);
        if (remaining > 0) {
          const partial = Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
          if (stream === 'stdout') {
            stdout += partial;
            stdoutBytes += Buffer.byteLength(partial, 'utf8');
          } else {
            stderr += partial;
            stderrBytes += Buffer.byteLength(partial, 'utf8');
          }
        }
        killProcessTree(child, 'SIGTERM');
        killTimer ??= setTimeout(() => {
          killProcessTree(child, 'SIGKILL');
        }, killGraceMs);
        return;
      }
      if (stream === 'stdout') {
        stdout += chunk;
        stdoutBytes += bytes;
      } else {
        stderr += chunk;
        stderrBytes += bytes;
      }
    };

    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk) => { appendOutput('stdout', chunk); });
    child.stderr?.on('data', (chunk) => { appendOutput('stderr', chunk); });
    child.stdin?.end(JSON.stringify(packet));

    child.on('error', (error) => {
      const elapsedMs = Date.now() - startedAt;
      finish(result('error', `Adapter command failed to start: ${error.message}`, commandOutputArtifact(packet, config, stdout, {
        error: error.message,
        stderr,
        elapsedMs,
        command,
        args,
      })));
    });

    child.on('close', (exitCode, signal) => {
      const elapsedMs = Date.now() - startedAt;
      const metadata = { exitCode, signal, timedOut, outputExceeded, timeoutMs, killGraceMs, maxOutputBytes, stdoutBytes, stderrBytes, elapsedMs, stderr, command, args };
      if (outputExceeded) {
        finish(result('blocked', `Adapter command exceeded max output of ${maxOutputBytes} bytes.`, commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      if (timedOut) {
        finish(result('blocked', `Adapter command timed out after ${timeoutMs}ms.`, commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      if (exitCode !== 0) {
        finish(result('error', `Adapter command exited with code ${exitCode}.`, commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      if (config.requireStructuredOutput === false) {
        finish(result('pass', 'Adapter command completed without structured-output validation.', commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        finish(result('error', `Adapter output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      const validation = validateAgentResult(parsed);
      if (!validation.value) {
        finish(result('error', `Adapter output failed AgentResult validation: ${validation.errors.join('; ')}`, commandOutputArtifact(packet, config, stdout, metadata)));
        return;
      }
      const commandArtifact = commandOutputArtifact(packet, config, stdout, metadata);
      finish({
        ...validation.value,
        artifacts: [...validation.value.artifacts, commandArtifact],
      });
    });
  });
}
