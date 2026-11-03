import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as pdp from "./pdp";
import { PdpGraphViewProvider } from "./graphView";
import { ProcessRegistry, type TrackedProcess } from "./processes";
import { ProcessItem, PdpRemoteProvider } from "./remoteView";
import { PdpTasksProvider, TaskItem } from "./tasksView";

const tasksProvider = new PdpTasksProvider();
const processes = new ProcessRegistry();
const remoteProvider = new PdpRemoteProvider(processes);
export let graphView: PdpGraphViewProvider | null = null;
let lastStatus: pdp.ProjectStatus | null = null;
let refreshing: Promise<pdp.ProjectStatus | null> | null = null;
let refreshQueued = false;
let queuedNotify = false;
const statusBar = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left,
);

export function activate(context: vscode.ExtensionContext): void {
  graphView = new PdpGraphViewProvider(
    context.extensionUri,
    (id) => void openTaskYml(id),
  );
  context.subscriptions.push(
    ...registerCommands(),
    vscode.window.createTreeView("pdp.tasks", {
      treeDataProvider: tasksProvider,
    }),
    vscode.window.createTreeView("pdp.remote", {
      treeDataProvider: remoteProvider,
    }),
    vscode.window.registerWebviewViewProvider("pdp.graph", graphView),
    graphView,
    statusBar,
    ...createWatchers(),
  );
  statusBar.command = "pdp.runAll";
  statusBar.name = "PDP stale count";
  void checkVersion();
  void refresh();
}

export function deactivate(): void {
  processes.stopAll();
}

export function hasPdpProject(): boolean {
  const root = pdp.workspaceRoot();
  return !!root && fs.existsSync(path.join(root, "pdp.yml"));
}

async function checkVersion(): Promise<void> {
  try {
    const found = await pdp.version();
    if (!pdp.versionAtLeast(found, pdp.MIN_PDP_VERSION)) {
      vscode.window.showWarningMessage(
        `pdp ${found} is too old (needs ${pdp.MIN_PDP_VERSION.join(".")}). ${pdp.UPGRADE_HINT}`,
      );
    }
  } catch (err) {
    vscode.window.showWarningMessage(
      `${(err as Error).message} ${pdp.UPGRADE_HINT}`,
    );
  }
}

function createWatchers(): vscode.Disposable[] {
  let timer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 500);
  };
  const watchers = ["**/{input,src,output,hand}/**", "**/*.yml"].map(
    (pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(scheduleRefresh);
      watcher.onDidCreate(scheduleRefresh);
      watcher.onDidDelete(scheduleRefresh);
      return watcher;
    },
  );
  const cancelPending = new vscode.Disposable(() => clearTimeout(timer));
  return [...watchers, cancelPending];
}

// One status call in flight; later requests coalesce into one re-run.
function refresh(notifyOnError = false): Promise<pdp.ProjectStatus | null> {
  if (refreshing) {
    refreshQueued = true;
    queuedNotify = queuedNotify || notifyOnError;
    return refreshing;
  }
  refreshing = doRefresh(notifyOnError).finally(() => {
    refreshing = null;
    if (refreshQueued) {
      refreshQueued = false;
      const notify = queuedNotify;
      queuedNotify = false;
      void refresh(notify);
    }
  });
  return refreshing;
}

async function doRefresh(
  notifyOnError: boolean,
): Promise<pdp.ProjectStatus | null> {
  const hasProject = hasPdpProject();
  void vscode.commands.executeCommand(
    "setContext",
    "pdp.hasProject",
    hasProject,
  );
  if (!hasProject) {
    lastStatus = null;
    tasksProvider.update(null);
    graphView?.update(null);
    statusBar.hide();
    return null;
  }
  try {
    const status = await pdp.status();
    lastStatus = status;
    tasksProvider.update(status);
    graphView?.update(status);
    const stale = status.tasks.filter((task) => task.stale).length;
    statusBar.text = `$(play) PDP: ${stale} stale`;
    statusBar.tooltip = `${stale} of ${status.tasks.length} tasks are stale. Click to run the stale tasks.`;
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return status;
  } catch (err) {
    lastStatus = null;
    tasksProvider.update(null);
    statusBar.text = "$(error) PDP";
    statusBar.tooltip = (err as Error).message;
    statusBar.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    statusBar.show();
    if (notifyOnError) {
      vscode.window.showErrorMessage(`PDP: ${(err as Error).message}`);
    }
    return null;
  }
}

function registerCommands(): vscode.Disposable[] {
  const register = (id: string, handler: (...args: unknown[]) => unknown) =>
    vscode.commands.registerCommand(id, handler);

  return [
    register("pdp.refresh", () => refresh(true)),

    register("pdp.runAll", () => runWithProgress([], "PDP: Run all")),
    register("pdp.runPick", runPick),
    register("pdp.runTask", (arg) =>
      withTask(arg, (id) => runWithProgress([id], `PDP: Run ${id}`)),
    ),
    register("pdp.runOnly", (arg) =>
      withTask(arg, (id) =>
        runWithProgress([id, "--only"], `PDP: Run only ${id}`),
      ),
    ),
    register("pdp.runTo", (arg) =>
      withTask(arg, (id) => runWithProgress(["--to", id], `PDP: Run to ${id}`)),
    ),
    register("pdp.runFrom", (arg) =>
      withTask(arg, (id) =>
        runWithProgress(["--from", id], `PDP: Run from ${id}`),
      ),
    ),
    register("pdp.runForce", (arg) =>
      withTask(arg, (id) =>
        runWithProgress([id, "--force"], `PDP: Force run ${id}`),
      ),
    ),
    register("pdp.runSlurm", (arg) =>
      withTask(arg, (id) =>
        runWithProgress([id, "--slurm"], `PDP: Run ${id} on Slurm`),
      ),
    ),

    register("pdp.cleanTask", (arg) =>
      withTask(arg, (id) => execSimple(["clean", id], `PDP: Cleaned ${id}`)),
    ),
    register("pdp.cleanAll", () => execSimple(["clean"], "PDP: Cleaned all")),
    register("pdp.validate", () =>
      execSimple(["validate"], "PDP: Valid project"),
    ),
    register("pdp.scaffold", () => execSimple(["scaffold"], "PDP: Scaffolded")),
    register("pdp.init", initProject),
    register("pdp.create", createTask),

    register("pdp.openTask", (arg) => withTask(arg, openTaskYml)),
    register("pdp.revealTask", (arg) => withTask(arg, revealTaskFolder)),

    register("pdp.dagsterLocal", () => startDagster(false)),
    register("pdp.dagsterSlurm", () => startDagster(true)),
    register("pdp.remoteStart", () =>
      processes.start("remote-tunnel", "Remote (tunnel)", ["remote", "start"]),
    ),
    register("pdp.remoteRefresh", () => refreshRemote()),
    register("pdp.remoteRunAll", () =>
      remoteCommand(["remote", "run"], "PDP: Remote run all", true),
    ),
    register("pdp.remoteRunTask", (arg) =>
      withTask(arg, (id) =>
        remoteCommand(["remote", "run", id], `PDP: Remote run ${id}`, true),
      ),
    ),
    register("pdp.remotePush", () =>
      remoteCommand(["remote", "push"], "PDP: Remote push", false),
    ),
    register("pdp.remotePull", () =>
      remoteCommand(["remote", "pull"], "PDP: Remote pull", false),
    ),
    register("pdp.remoteStop", () =>
      remoteCommand(["remote", "stop"], "PDP: Remote stop", false).then(() =>
        processes.stop("remote-tunnel"),
      ),
    ),
    register("pdp.openDagsterUi", async (arg) => {
      const process = await processFromArgOrPick(arg);
      if (process) {
        processes.openUi(process);
      }
    }),
    register("pdp.stopProcess", async (arg) => {
      const process = await processFromArgOrPick(arg);
      if (process) {
        processes.stop(process.id);
      }
    }),
  ];
}

function startDagster(slurm: boolean): void {
  const port =
    vscode.workspace.getConfiguration("pdp").get<number>("dagsterPort") ?? 3000;
  const args = ["dagster", "dev"];
  if (slurm) {
    args.push("--slurm");
  }
  args.push("-p", String(port));
  processes.start(
    slurm ? "dagster-slurm" : "dagster-local",
    slurm ? "Dagster (Slurm)" : "Dagster (local)",
    args,
  );
}

async function refreshRemote(): Promise<void> {
  try {
    remoteProvider.update(await pdp.remoteStatus());
  } catch (err) {
    const message = (err as Error).message;
    remoteProvider.update(null, message);
    await showError(message);
  }
}

async function processFromArgOrPick(
  arg: unknown,
): Promise<TrackedProcess | undefined> {
  if (arg instanceof ProcessItem) {
    return arg.process;
  }
  const list = processes.list();
  if (!list.length) {
    vscode.window.showInformationMessage("PDP: No background processes");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    list.map((process) => ({
      label: process.label,
      description: process.url ?? "starting…",
      process,
    })),
    { placeHolder: "Choose a process" },
  );
  return picked?.process;
}

async function initProject(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Project name",
    placeHolder: "my-project",
    validateInput: (value) => (value.trim() ? null : "Enter a project name"),
  });
  if (name === undefined) {
    return;
  }
  await execSimple(["init", "--name", name.trim()], `PDP: Init ${name.trim()}`);
}

async function createTask(): Promise<void> {
  const id = await vscode.window.showInputBox({
    prompt: "Task id",
    placeHolder: "fetch",
    validateInput: (value) =>
      /^[a-z0-9][a-z0-9_-]*$/i.test(value.trim())
        ? null
        : "Use letters, digits, - or _",
  });
  if (id === undefined) {
    return;
  }
  await execSimple(["create", id.trim()], `PDP: Created ${id.trim()}`);
}

async function execSimple(args: string[], success: string): Promise<void> {
  try {
    const res = await pdp.exec(args);
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || "pdp failed");
    }
    await refresh();
    vscode.window.showInformationMessage(success);
  } catch (err) {
    await refresh();
    await showError((err as Error).message);
  }
}

interface RunResult {
  code: number;
  report: pdp.RunReport;
  cancelled: boolean;
}

async function spawnWithProgress(
  args: string[],
  title: string,
): Promise<RunResult> {
  let child: pdp.SpawnedPdp | null = null;
  let cancelled = false;
  return vscode.window.withProgress<RunResult>(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, token) => {
      child = pdp.spawnPdp(args);
      token.onCancellationRequested(() => {
        cancelled = true;
        child?.kill("SIGINT");
      });
      const res = await child.done;
      return {
        code: res.code,
        report: pdp.reportFromOutput(res.stdout, res.stderr),
        cancelled,
      };
    },
  );
}

async function runWithProgress(args: string[], title: string): Promise<void> {
  await commandWithProgress(["run", ...args], title, true);
}

async function remoteCommand(
  args: string[],
  title: string,
  useReport: boolean,
): Promise<void> {
  await commandWithProgress(args, title, useReport);
}

async function commandWithProgress(
  args: string[],
  title: string,
  useReport: boolean,
): Promise<void> {
  try {
    const result = await spawnWithProgress(args, title);
    await refresh();
    if (useReport) {
      notifyRunResult(title, result);
    } else if (result.code !== 0) {
      await showError(`${title} failed (exit ${result.code})`);
    } else if (result.cancelled) {
      vscode.window.showWarningMessage(`${title}: cancelled`);
    } else {
      vscode.window.showInformationMessage(`${title}: done`);
    }
  } catch (err) {
    await refresh();
    await showError((err as Error).message);
  }
}

function notifyRunResult(title: string, result: RunResult): void {
  const summary = pdp.reportSummary(result.report);
  const outputDetail = result.report.noOutput.length > 0;
  if (result.cancelled) {
    vscode.window.showWarningMessage(`${title}: cancelled (${summary})`);
  } else if (result.code !== 0) {
    vscode.window
      .showErrorMessage(`${title}: ${summary}`, "Show Output")
      .then((choice) => choice === "Show Output" && pdp.channel.show());
  } else if (outputDetail) {
    vscode.window.showWarningMessage(`${title}: ${summary}`);
  } else {
    vscode.window.showInformationMessage(`${title}: ${summary}`);
  }
}

async function runPick(): Promise<void> {
  const tasks = lastStatus?.tasks ?? (await refresh(), lastStatus?.tasks);
  if (!tasks?.length) {
    vscode.window.showInformationMessage("PDP: No tasks to run");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    tasks.map((task) => ({
      label: task.id,
      description: task.stale ? "stale" : "fresh",
      task,
    })),
    { canPickMany: true, placeHolder: "Tasks to run" },
  );
  if (!picked?.length) {
    return;
  }
  const options = await vscode.window.showQuickPick(
    [
      { label: "Only", description: "run without upstream", args: ["--only"] },
      { label: "Force", description: "run even if fresh", args: ["--force"] },
      {
        label: "Slurm",
        description: "run each task as a Slurm job",
        args: ["--slurm"],
      },
      {
        label: "Runner: pdp",
        description: "run with pdp, not Dagster",
        args: ["--runner", "pdp"],
      },
      {
        label: "Runner: dagster",
        description: "run with Dagster",
        args: ["--runner", "dagster"],
      },
    ],
    { canPickMany: true, placeHolder: "Run options" },
  );
  const args = [
    ...picked.map((p) => p.task.id),
    ...(options ?? []).flatMap((o) => o.args),
  ];
  await runWithProgress(args, "PDP: Run");
}

async function withTask(
  arg: unknown,
  action: (taskId: string) => Promise<void>,
): Promise<void> {
  const task = await taskFromArgOrPick(arg);
  if (task) {
    await action(task.id);
  }
}

async function taskFromArgOrPick(
  arg: unknown,
): Promise<pdp.TaskStatus | undefined> {
  if (arg instanceof TaskItem) {
    return arg.task;
  }
  const tasks = lastStatus?.tasks;
  if (!tasks?.length) {
    await refresh();
  }
  const list = lastStatus?.tasks ?? [];
  if (!list.length) {
    vscode.window.showInformationMessage("PDP: No tasks found");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    list.map((task) => ({
      label: task.id,
      description: task.stale ? "stale" : "fresh",
      task,
    })),
    { placeHolder: "Choose a task" },
  );
  return picked?.task;
}

// pdp output is untrusted: a crafted id must not escape the workspace root
function taskFolder(id: string): string | undefined {
  if (/[\\/]|\.\./.test(id)) {
    vscode.window.showWarningMessage(`PDP: Invalid task id "${id}"`);
    return undefined;
  }
  const root = pdp.workspaceRoot();
  return root && path.join(root, id);
}

async function openTaskYml(id: string): Promise<void> {
  const folder = taskFolder(id);
  if (!folder) {
    return;
  }
  const uri = vscode.Uri.file(path.join(folder, "task.yml"));
  if (!fs.existsSync(uri.fsPath)) {
    vscode.window.showWarningMessage(`PDP: No task.yml for ${id}`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

async function revealTaskFolder(id: string): Promise<void> {
  const folder = taskFolder(id);
  if (!folder) {
    return;
  }
  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.file(folder),
  );
}

async function showError(message: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    `PDP: ${message}`,
    "Show Output",
  );
  if (choice === "Show Output") {
    pdp.channel.show();
  }
}
