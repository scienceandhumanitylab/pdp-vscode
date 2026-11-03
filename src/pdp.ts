import { execFile, spawn } from "child_process";
import * as vscode from "vscode";

export interface TaskStatus {
  id: string;
  stale: boolean;
  depends_on: string[];
  description: string;
  entrypoint: string;
  slurm: Record<string, string>;
}

export interface ProjectStatus {
  project: string;
  tasks: TaskStatus[];
}

export interface RunReport {
  ran: string[];
  current: string[];
  failed: string[];
  noEntrpoint: string[];
  skipped: string[];
  noOutput: string[];
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

// First pdp release with `status --json` / `remote status --json`.
export const MIN_PDP_VERSION = [0, 2, 4];
export const UPGRADE_HINT =
  "Upgrade pdp with: uv tool upgrade pdp (then reload the window)";

export const channel = vscode.window.createOutputChannel("PDP");

export function pdpBinary(): string {
  return vscode.workspace.getConfiguration("pdp").get<string>("path") ?? "pdp";
}

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function versionAtLeast(version: string, min: number[]): boolean {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return false;
  }
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < min.length; i++) {
    if (parts[i] > min[i]) {
      return true;
    }
    if (parts[i] < min[i]) {
      return false;
    }
  }
  return true;
}

// rich wraps output at COLUMNS; 200 keeps report lines on one line.
function pdpEnv(): NodeJS.ProcessEnv {
  return { ...process.env, COLUMNS: "200" };
}

export function exec(args: string[]): Promise<ExecResult> {
  const root = workspaceRoot();
  if (!root) {
    return Promise.reject(new Error("Open a workspace folder first."));
  }
  channel.appendLine(`$ pdp ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    execFile(
      pdpBinary(),
      args,
      { cwd: root, env: pdpEnv(), maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = (err as { code?: number | string } | null)?.code;
        if (err && typeof code !== "number") {
          const reason =
            (err as NodeJS.ErrnoException).code ?? (err as Error).message;
          reject(
            new Error(
              `Could not run pdp at "${pdpBinary()}" (${reason}). Check the pdp.path setting.`,
            ),
          );
          return;
        }
        resolve({
          code: typeof code === "number" ? code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

export async function version(): Promise<string> {
  const res = await exec(["--version"]);
  return res.stdout.trim();
}

export function parseStatus(text: string): ProjectStatus {
  const parsed = JSON.parse(text) as ProjectStatus;
  if (!parsed || !Array.isArray(parsed.tasks)) {
    throw new Error("Unexpected pdp status JSON");
  }
  return parsed;
}

export async function status(): Promise<ProjectStatus> {
  const res = await exec(["status", "--json"]);
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || "pdp status failed");
  }
  return parseStatus(res.stdout);
}

export interface RemoteRunLast {
  finished?: string;
  ran?: string[];
  failed?: string[];
  no_entrypoint?: string[];
  exit_code?: number;
}

export interface RemoteStatus {
  host: string;
  path: string;
  port: string;
  version: string;
  pushed: boolean;
  session: { name: string; running: boolean };
  run: { running: boolean; last: RemoteRunLast | null };
  dagster_listening: boolean;
  jobs: string[] | null;
}

export function parseRemoteStatus(text: string): RemoteStatus {
  const parsed = JSON.parse(text) as RemoteStatus;
  if (!parsed || typeof parsed.host !== "string" || !parsed.session) {
    throw new Error("Unexpected pdp remote status JSON");
  }
  return parsed;
}

export async function remoteStatus(): Promise<RemoteStatus> {
  const res = await exec(["remote", "status", "--json"]);
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || "pdp remote status failed");
  }
  return parseRemoteStatus(res.stdout);
}

export interface SpawnedPdp {
  done: Promise<ExecResult>;
  kill: (signal?: NodeJS.Signals) => void;
}

export function spawnPdp(
  args: string[],
  onOutput?: (chunk: string) => void,
): SpawnedPdp {
  const root = workspaceRoot();
  if (!root) {
    return {
      done: Promise.reject(new Error("Open a workspace folder first.")),
      kill: () => undefined,
    };
  }
  channel.appendLine(`$ pdp ${args.join(" ")}`);
  // detached makes pdp a process-group leader so one signal reaches the
  // whole task tree (make, srun children), like Ctrl-C in a terminal.
  const child = spawn(pdpBinary(), args, {
    cwd: root,
    env: pdpEnv(),
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data: Buffer) => {
    stdout += data.toString();
    channel.append(data.toString());
    onOutput?.(data.toString());
  });
  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
    channel.append(data.toString());
    onOutput?.(data.toString());
  });
  const done = new Promise<ExecResult>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `Could not run pdp at "${pdpBinary()}" (${err.code ?? err.message}). Check the pdp.path setting.`,
        ),
      );
    });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
  return {
    done,
    kill: (signal = "SIGINT") => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        // the group is already gone
      }
    },
  };
}

const REPORT_PREFIXES: [string, keyof RunReport][] = [
  ["Ran: ", "ran"],
  ["Current: ", "current"],
  ["Failed: ", "failed"],
  ["No entrypoint (failed): ", "noEntrpoint"],
  ["Skipped (upstream failed): ", "skipped"],
  ["Ran but wrote nothing to output/: ", "noOutput"],
];

function isReportLine(line: string): boolean {
  return (
    REPORT_PREFIXES.some(([prefix]) => line.startsWith(prefix)) ||
    line === "Wrote:" ||
    line.startsWith("  ")
  );
}

// shortcut: only the trailing block is parsed; task output whose last lines
// mimic report lines can still fool this, upgrade if pdp grows a report flag
export function parseReport(text: string): RunReport {
  const report: RunReport = {
    ran: [],
    current: [],
    failed: [],
    noEntrpoint: [],
    skipped: [],
    noOutput: [],
  };
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  let start = lines.length;
  while (start > 0 && isReportLine(lines[start - 1])) {
    start--;
  }
  for (const line of lines.slice(start)) {
    for (const [prefix, key] of REPORT_PREFIXES) {
      if (line.startsWith(prefix)) {
        report[key] = line
          .slice(prefix.length)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }
    }
  }
  return report;
}

export function reportFromOutput(stdout: string, stderr: string): RunReport {
  // trimEnd avoids a blank line between the stdout and stderr report halves
  return parseReport(`${stdout.trimEnd()}\n${stderr}`);
}

export function reportSummary(report: RunReport): string {
  const parts: string[] = [];
  if (report.ran.length) {
    parts.push(`ran: ${report.ran.join(", ")}`);
  }
  if (report.current.length) {
    parts.push(`current: ${report.current.join(", ")}`);
  }
  if (report.failed.length) {
    parts.push(`failed: ${report.failed.join(", ")}`);
  }
  if (report.noEntrpoint.length) {
    parts.push(`no entrypoint: ${report.noEntrpoint.join(", ")}`);
  }
  if (report.skipped.length) {
    parts.push(`skipped: ${report.skipped.join(", ")}`);
  }
  if (report.noOutput.length) {
    parts.push(`no output: ${report.noOutput.join(", ")}`);
  }
  return parts.join(" · ") || "nothing to run";
}
