import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as pdp from "./pdp";
import { GRAPH_LAYOUTS, PdpGraphViewProvider } from "./graphView";
import { ProcessRegistry, type TrackedProcess } from "./processes";
import { ProcessItem, PdpRemoteProvider } from "./remoteView";
import {
  missingTaskFolders,
  PdpTasksProvider,
  TaskItem,
  taskFolderPath,
} from "./tasksView";

const tasksProvider = new PdpTasksProvider();
const processes = new ProcessRegistry();
const remoteProvider = new PdpRemoteProvider(processes);
export let graphView: PdpGraphViewProvider | null = null;
// Keybindings read the focused row through the tree's own selection.
export let tasksTree: vscode.TreeView<vscode.TreeItem> | null = null;
let lastStatus: pdp.ProjectStatus | null = null;
let lastError: string | null = null;
let refreshing: Promise<pdp.ProjectStatus | null> | null = null;
let refreshQueued = false;
let queuedNotify = false;
const statusBar = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left,
);

export function activate(context: vscode.ExtensionContext): void {
  graphView = new PdpGraphViewProvider(
    context.extensionUri,
    context.workspaceState,
    (id) => void openTaskYml(id),
    (id) => void taskMenu(id),
  );
  tasksTree = vscode.window.createTreeView("pdp.tasks", {
    treeDataProvider: tasksProvider,
  });
  context.subscriptions.push(
    ...registerCommands(),
    tasksTree,
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
    lastError = null;
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
    lastError = null;
    void promptMissingFolders(status);
    return status;
  } catch (err) {
    // Keep the last good status on screen; an emptied sidebar looks unrecoverable.
    const message = (err as Error).message;
    statusBar.text = "$(error) PDP";
    statusBar.tooltip = message;
    statusBar.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
    statusBar.show();
    if (notifyOnError || message !== lastError) {
      void showError(message);
    }
    lastError = message;
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
    register("pdp.runTaskConfirm", (arg) =>
      confirmThen(
        arg,
        "Run",
        "Runs pdp run <id>: the task and any stale upstream tasks.",
        "pdp.runTask",
      ),
    ),
    register("pdp.runOnly", (arg) =>
      withTask(arg, (id) =>
        runWithProgress([id, "--only"], `PDP: Run only ${id}`),
      ),
    ),
    register("pdp.runTo", (arg) =>
      withTask(arg, (id) => runWithProgress(["--to", id], `PDP: Run to ${id}`)),
    ),
    register("pdp.runToConfirm", (arg) =>
      confirmThen(
        arg,
        "Run to",
        "Runs pdp run --to <id>: the task and everything upstream of it.",
        "pdp.runTo",
      ),
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

    register("pdp.freshenTask", (arg) =>
      withTask(arg, (id) => freshenTask(id, false)),
    ),
    register("pdp.freshenOnly", (arg) =>
      withTask(arg, (id) => freshenTask(id, true)),
    ),

    register("pdp.cleanTask", (arg) =>
      withTask(arg, (id) => execSimple(["clean", id], `PDP: Cleaned ${id}`)),
    ),
    register("pdp.cleanTaskConfirm", (arg) =>
      confirmThen(
        arg,
        "Clean",
        "Runs pdp clean <id>, which removes the task's outputs.",
        "pdp.cleanTask",
      ),
    ),
    register("pdp.deleteTask", (arg) => withTask(arg, deleteTask)),
    register("pdp.cleanAll", () => execSimple(["clean"], "PDP: Cleaned all")),
    register("pdp.validate", validateProject),
    register("pdp.scaffold", () => execSimple(["scaffold"], "PDP: Scaffolded")),
    register("pdp.init", initProject),
    register("pdp.create", createTask),

    register("pdp.openTask", (arg) => withTask(arg, openTaskYml)),
    register("pdp.openTaskSrc", (arg) => withTask(arg, openTaskSrc)),
    register("pdp.revealTask", (arg) => withTask(arg, revealTaskFolder)),
    register("pdp.revealTaskOutput", (arg) => withTask(arg, revealTaskOutput)),
    register("pdp.saveGraphLayout", () => graphView?.saveDefault()),
    register("pdp.resetGraphLayout", () => graphView?.resetLayout()),
    register("pdp.graphZoomIn", () => graphView?.zoomBy(1.25)),
    register("pdp.graphZoomOut", () => graphView?.zoomBy(1 / 1.25)),
    register("pdp.graphChooseLayout", chooseGraphLayout),
    register("pdp.showShortcuts", showShortcuts),

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
      TASK_ID_PATTERN.test(value.trim()) ? null : "Use letters, digits, - or _",
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

// Task ids travel to pdp as bare argv words, so an id like "--force" in a
// hostile pdp.yml must never be dispatched as if the user picked it.
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

// Right-click a graph node: the task-level actions as a QuickPick, dispatched
// to the existing commands with the task id so nothing re-prompts.
const TASK_MENU_ACTIONS = [
  { label: "Run", command: "pdp.runTask" },
  { label: "Run only", command: "pdp.runOnly" },
  { label: "Run to here", command: "pdp.runTo" },
  { label: "Run from here", command: "pdp.runFrom" },
  { label: "Force run", command: "pdp.runForce" },
  { label: "Run on Slurm", command: "pdp.runSlurm" },
  { label: "Freshen (downstream)", command: "pdp.freshenTask" },
  { label: "Freshen only", command: "pdp.freshenOnly" },
  { label: "Clean", command: "pdp.cleanTask" },
  { label: "Open task.yml", command: "pdp.openTask" },
  { label: "Open source file", command: "pdp.openTaskSrc" },
  { label: "Delete…", command: "pdp.deleteTask" },
];

async function taskMenu(id: string): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    TASK_MENU_ACTIONS.map((action) => ({ ...action, description: id })),
    { placeHolder: `PDP: ${id}` },
  );
  if (picked) {
    await vscode.commands.executeCommand(picked.command, id);
  }
}

// The ? cheat sheet mirrors the A and C keybindings.
// shortcut: the extension API cannot read user keybindings, so the list
// shows the defaults; Customize… shows the real ones.
const SHORTCUTS: Record<
  "graph" | "tasks",
  { key: string; label: string; command: string }[]
> = {
  graph: [
    { key: "i", label: "Zoom in", command: "pdp.graphZoomIn" },
    { key: "o", label: "Zoom out", command: "pdp.graphZoomOut" },
    { key: "l", label: "Choose layout", command: "pdp.graphChooseLayout" },
    {
      key: "s",
      label: "Save layout as default",
      command: "pdp.saveGraphLayout",
    },
    { key: "r", label: "Reset layout", command: "pdp.resetGraphLayout" },
  ],
  tasks: [
    { key: "Enter", label: "Open task.yml", command: "pdp.openTask" },
    { key: "r", label: "Run task", command: "pdp.runTaskConfirm" },
    { key: "c", label: "Clean task", command: "pdp.cleanTaskConfirm" },
    { key: "t", label: "Run to here", command: "pdp.runToConfirm" },
    {
      key: "f",
      label: "Freshen task (and downstream)",
      command: "pdp.freshenTask",
    },
    { key: "d", label: "Delete task…", command: "pdp.deleteTask" },
    { key: "s", label: "Open source file", command: "pdp.openTaskSrc" },
    {
      key: "o",
      label: "Reveal output folder",
      command: "pdp.revealTaskOutput",
    },
  ],
};

async function showShortcuts(arg: unknown): Promise<void> {
  const scopes: ("graph" | "tasks")[] =
    arg === "graph" || arg === "tasks" ? [arg] : ["graph", "tasks"];
  const items: (vscode.QuickPickItem & {
    command: string;
    selected: boolean;
  })[] = [];
  for (const scope of scopes) {
    if (scopes.length > 1) {
      items.push({
        label: scope === "graph" ? "Graph" : "Tasks",
        kind: vscode.QuickPickItemKind.Separator,
        command: "",
        selected: false,
      });
    }
    for (const entry of SHORTCUTS[scope]) {
      items.push({
        label: entry.key,
        description: entry.label,
        command: entry.command,
        selected: scope === "tasks",
      });
    }
  }
  items.push({
    label: "Customize…",
    description: "open the Keyboard Shortcuts page",
    command: "workbench.action.openGlobalKeybindings",
    selected: false,
  });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "PDP: Keyboard shortcuts",
  });
  if (!picked) {
    return;
  }
  if (picked.command === "workbench.action.openGlobalKeybindings") {
    await vscode.commands.executeCommand(picked.command, "pdp.");
    return;
  }
  await vscode.commands.executeCommand(
    picked.command,
    ...(picked.selected ? [{ selected: true }] : []),
  );
}

async function chooseGraphLayout(): Promise<void> {
  if (graphView?.openLayoutMenu()) {
    return;
  }
  const picked = await vscode.window.showQuickPick(GRAPH_LAYOUTS, {
    placeHolder: "Graph layout",
  });
  if (picked) {
    await graphView?.chooseLayout(picked.name);
  }
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
  // Keybindings pass { selected: true }: act on the focused row when it is a
  // task; any other selection (pdp.yml, a file) falls through to the pick.
  if (
    typeof arg === "object" &&
    arg !== null &&
    (arg as { selected?: unknown }).selected === true
  ) {
    const picked = tasksTree?.selection[0];
    if (picked instanceof TaskItem) {
      return picked.task;
    }
  }
  // Dispatched commands pass a task id string; check its shape and validate
  // it against the last status so nothing unknown or forged reaches pdp.
  if (typeof arg === "string") {
    if (!TASK_ID_PATTERN.test(arg)) {
      vscode.window.showWarningMessage(`PDP: Invalid task id "${arg}"`);
      return undefined;
    }
    if (!lastStatus) {
      await refresh();
    }
    const task = lastStatus?.tasks.find((candidate) => candidate.id === arg);
    if (!task) {
      vscode.window.showWarningMessage(`PDP: Unknown task "${arg}"`);
    }
    return task;
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

function taskFolder(id: string): string | undefined {
  const root = pdp.workspaceRoot();
  if (!root) {
    return undefined;
  }
  const folder = taskFolderPath(root, id);
  if (!folder) {
    vscode.window.showWarningMessage(`PDP: Invalid task id "${id}"`);
  }
  return folder;
}

async function freshenTask(id: string, only: boolean): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Freshen "${id}" without running it?`,
    {
      modal: true,
      detail: only
        ? `Marks "${id}" fresh by setting its output file times to now. Its outputs are not recomputed.`
        : `Marks "${id}" and every stale task downstream of it fresh by setting output file times to now. Outputs are not recomputed.`,
    },
    "Freshen",
  );
  if (choice !== "Freshen") {
    return;
  }
  await freshenRun(only ? ["freshen", id, "--only"] : ["freshen", id]);
}

// Reached from the task menu (after its modal) and from the Freshen
// Downstream button in the result notification (the click is the consent).
async function freshenRun(args: string[]): Promise<void> {
  try {
    const res = await pdp.exec(args);
    const report = pdp.parseFreshen(res.stdout, res.stderr);
    // exit 1 with a report means "selected task still stale"; only a bare
    // failure (refusal such as stale upstream, empty output) is an error
    if (
      res.code !== 0 &&
      !report.freshened.length &&
      !report.stillStale.length &&
      !report.newlyStale.length
    ) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || "pdp freshen failed",
      );
    }
    await refresh();
    notifyFreshenResult(report);
  } catch (err) {
    await refresh();
    await showError((err as Error).message);
  }
}

function notifyFreshenResult(report: pdp.FreshenReport): void {
  const parts: string[] = [];
  if (report.freshened.length) {
    parts.push(`freshened: ${report.freshened.join(", ")}`);
  }
  if (report.stillStale.length) {
    parts.push(`still stale: ${report.stillStale.join(", ")}`);
  }
  const summary = parts.join(" · ") || "nothing to freshen";
  if (report.newlyStale.length) {
    const message = `PDP: ${summary} — freshening made ${report.newlyStale.join(", ")} stale`;
    // The follow-up id comes from parsed pdp output, so it passes the same
    // gate as dispatched task ids; and without a freshened task, --from
    // would refuse on the still-stale upstream anyway.
    const first = report.freshened.length ? report.newlyStale[0] : undefined;
    if (first !== undefined && TASK_ID_PATTERN.test(first)) {
      vscode.window
        .showWarningMessage(message, "Freshen Downstream")
        .then(
          (choice) =>
            choice === "Freshen Downstream" &&
            void freshenRun(["freshen", "--from", first]),
        );
    } else {
      vscode.window.showWarningMessage(message);
    }
  } else if (report.stillStale.length) {
    vscode.window.showWarningMessage(`PDP: ${summary}`);
  } else {
    vscode.window.showInformationMessage(`PDP: ${summary}`);
  }
}

async function validateProject(): Promise<void> {
  try {
    const res = await pdp.exec(["validate"]);
    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || res.stdout.trim() || "pdp validate failed",
      );
    }
    const warnings = res.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("Warning: "))
      .map((line) => line.slice("Warning: ".length));
    if (warnings.length) {
      vscode.window.showWarningMessage(
        `PDP: Valid with warnings — ${warnings.join("; ")}`,
      );
    } else {
      vscode.window.showInformationMessage("PDP: Valid project");
    }
  } catch (err) {
    await refresh();
    await showError((err as Error).message);
  }
}

async function deleteTask(id: string): Promise<void> {
  const folder = taskFolder(id);
  if (!folder) {
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Delete task "${id}"?`,
    {
      modal: true,
      detail: `Deletes the folder ${folder} and removes "${id}" from pdp.yml. This cannot be undone.`,
    },
    "Delete",
  );
  if (choice !== "Delete") {
    return;
  }
  // The folder vanishes before pdp.yml is rewritten; don't let a watcher
  // refresh in between offer to "clean up" the task being deleted.
  dismissedMissing.add(id);
  await execSimple(["delete", id, "--yes"], `PDP: Deleted ${id}`);
  if (fs.existsSync(folder)) {
    dismissedMissing.delete(id); // refused or failed: a later manual delete prompts
  }
}

// Asked once per session per id, so watcher refreshes do not re-prompt.
const dismissedMissing = new Set<string>();
let promptingMissing = false;

async function promptMissingFolders(status: pdp.ProjectStatus): Promise<void> {
  const root = pdp.workspaceRoot();
  if (!root || promptingMissing) {
    return;
  }
  const missing = missingTaskFolders(status, root).filter(
    (id) => !dismissedMissing.has(id),
  );
  if (!missing.length) {
    return;
  }
  missing.forEach((id) => dismissedMissing.add(id));
  promptingMissing = true;
  try {
    const choice = await vscode.window.showWarningMessage(
      `Listed in pdp.yml but folder is missing: ${missing.join(", ")}.`,
      {
        modal: true,
        detail:
          "Scaffold recreates their folders from pdp.yml; Remove deletes their entries from pdp.yml.",
      },
      "Scaffold",
      "Remove",
    );
    if (choice === "Scaffold") {
      await execSimple(["scaffold"], "PDP: Scaffolded");
      return;
    }
    if (choice !== "Remove") {
      return;
    }
    // A folder restored while the modal was open (git checkout) must survive.
    const stillMissing = new Set(missingTaskFolders(status, root));
    const toRemove = missing.filter((id) => stillMissing.has(id));
    const errors: string[] = [];
    // Status is topological; dependents go first so pdp delete allows each.
    for (const id of [...toRemove].reverse()) {
      const res = await pdp.exec(["delete", id, "--yes"]);
      if (res.code !== 0) {
        errors.push(res.stderr.trim() || res.stdout.trim() || `${id} failed`);
      }
    }
    await refresh();
    if (errors.length) {
      await showError(errors.join("\n"));
    } else if (toRemove.length) {
      vscode.window.showInformationMessage(
        `PDP: Removed ${toRemove.join(", ")}`,
      );
    }
  } finally {
    promptingMissing = false;
  }
}

// The keyboard path confirms before running; inline buttons and context
// menus keep calling the unconfirmed commands.
async function confirmThen(
  arg: unknown,
  verb: string,
  detail: string,
  command: string,
): Promise<void> {
  await withTask(arg, async (id) => {
    const choice = await vscode.window.showWarningMessage(
      `${verb} "${id}"?`,
      { modal: true, detail },
      verb,
    );
    if (choice === verb) {
      await vscode.commands.executeCommand(command, id);
    }
  });
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

async function revealTaskOutput(id: string): Promise<void> {
  const folder = taskFolder(id);
  if (!folder) {
    return;
  }
  const output = path.join(folder, "output");
  if (!fs.existsSync(output)) {
    vscode.window.showInformationMessage(
      `PDP: ${id} has no output/ folder yet`,
    );
    return;
  }
  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.file(output),
  );
}

async function openTaskSrc(id: string): Promise<void> {
  const folder = taskFolder(id);
  if (!folder) {
    return;
  }
  const src = path.join(folder, "src");
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(src, "**/*"),
  );
  if (uris.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      `PDP: No files in ${id}/src`,
      "Reveal Folder",
    );
    if (choice === "Reveal Folder") {
      await vscode.commands.executeCommand("pdp.revealTask", id);
    }
    return;
  }
  if (uris.length === 1) {
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uris[0]),
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    uris
      .map((uri) => ({ label: path.relative(src, uri.fsPath), uri }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    { placeHolder: `Source file for ${id}` },
  );
  if (picked) {
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(picked.uri),
    );
  }
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
