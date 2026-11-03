import * as vscode from "vscode";
import * as pdp from "./pdp";

export interface TrackedProcess {
  id: string;
  label: string;
  url?: string;
}

export interface ProcessSource {
  list(): TrackedProcess[];
  onDidChange: vscode.Event<void>;
}

export type Spawner = (
  args: string[],
  onOutput: (chunk: string) => void,
) => pdp.SpawnedPdp;

const defaultSpawner: Spawner = (args, onOutput) =>
  pdp.spawnPdp(args, onOutput);

// shortcut: a URL split across two output chunks needs the accumulated
// buffer, so we rescan the full text on every chunk
function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s'"]+/)?.[0];
}

async function openUi(url: string, external: boolean): Promise<void> {
  if (!external) {
    try {
      await vscode.commands.executeCommand("simpleBrowser.show", url);
      return;
    } catch {
      // Simple Browser unavailable (e.g. web): fall back
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

export class ProcessRegistry implements ProcessSource {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChange = this.change.event;
  private readonly entries = new Map<
    string,
    { meta: TrackedProcess; proc: pdp.SpawnedPdp }
  >();

  constructor(private readonly spawn: Spawner = defaultSpawner) {}

  list(): TrackedProcess[] {
    return [...this.entries.values()].map((entry) => entry.meta);
  }

  get(id: string): TrackedProcess | undefined {
    return this.entries.get(id)?.meta;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  start(id: string, label: string, args: string[]): void {
    if (this.entries.has(id)) {
      vscode.window.showInformationMessage(`PDP: ${label} is already running`);
      return;
    }
    const meta: TrackedProcess = { id, label };
    const state = { output: "" };
    const proc = this.spawn(args, (chunk) => {
      state.output += chunk;
      const url = firstUrl(state.output);
      if (url && meta.url !== url) {
        meta.url = url;
        this.change.fire();
        void this.announceUi(label, url);
      }
    });
    this.entries.set(id, { meta, proc });
    this.change.fire();
    void proc.done
      .then((res) => this.remove(id, res.code))
      .catch((err) => {
        this.remove(id, 1);
        void vscode.window.showErrorMessage(
          `PDP: ${label}: ${(err as Error).message}`,
        );
      });
  }

  stop(id: string): void {
    this.entries.get(id)?.proc.kill("SIGINT");
  }

  stopAll(): void {
    const procs = [...this.entries.values()].map((entry) => entry.proc);
    for (const proc of procs) {
      proc.kill("SIGINT");
    }
    // shortcut: SIGKILL backstop only lands if the host lives 2s past deactivate
    setTimeout(() => {
      for (const proc of procs) {
        proc.kill("SIGKILL");
      }
    }, 2000).unref();
  }

  openUi(process: TrackedProcess): void {
    if (process.url) {
      void openUi(process.url, false);
    } else {
      vscode.window.showInformationMessage(
        `PDP: ${process.label} has no UI URL yet`,
      );
    }
  }

  private remove(id: string, code: number): void {
    const label = this.entries.get(id)?.meta.label ?? id;
    this.entries.delete(id);
    this.change.fire();
    if (code !== 0 && code !== 130) {
      vscode.window.showErrorMessage(
        `PDP: ${label} exited with code ${code}. See PDP output for details.`,
      );
    }
  }

  private async announceUi(label: string, url: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `PDP: ${label} is ready at ${url}`,
      "Simple Browser",
      "External Browser",
    );
    if (choice) {
      await openUi(url, choice === "External Browser");
    }
  }
}
