import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as pdp from "../pdp";
import { parseFreshen } from "../pdp";
import { graphView, lastRunTracker, tasksTree } from "../extension";
import { FileItem, PdpTasksProvider, TaskItem } from "../tasksView";

// Runs against the real pdp binary in src/test/fixtures/demo, which the
// test workspace opens (see .vscode-test.mjs).

// The output-file watcher's debounced refresh (500 ms) re-renders the tree;
// wait it out before revealing rows in it.
const settleWatcher = () => new Promise((resolve) => setTimeout(resolve, 700));

suite("fixture integration", () => {
  test("status parses the demo project in topological order", async () => {
    const status = await pdp.status();
    assert.strictEqual(status.project, "demo");
    assert.deepStrictEqual(
      status.tasks.map((task) => task.id),
      ["import", "clean", "filter", "explore", "model", "report"],
    );
  });

  // model's src sleeps 3 s, so a full run needs more than mocha's 2 s default.
  test("run all reports every task and leaves them fresh", async () => {
    await pdp.exec(["clean"]);
    const child = pdp.spawnPdp(["run"]);
    const res = await child.done;
    assert.strictEqual(res.code, 0);
    const report = pdp.reportFromOutput(res.stdout, res.stderr);
    assert.deepStrictEqual(report.ran, [
      "import",
      "clean",
      "filter",
      "explore",
      "model",
      "report",
    ]);
    assert.deepStrictEqual(report.failed, []);
    assert.deepStrictEqual(report.noOutput, []);

    const status = await pdp.status();
    assert.ok(
      status.tasks.every((task) => !task.stale),
      `expected all fresh, got ${JSON.stringify(status.tasks.map((t) => [t.id, t.stale]))}`,
    );

    const provider = new PdpTasksProvider();
    provider.update(status);
    const items = (await provider.getChildren()).filter(
      (item) => item instanceof TaskItem,
    );
    assert.deepStrictEqual(
      items.map((item) => item.label),
      ["import", "clean", "filter", "explore", "model", "report"],
    );
    assert.strictEqual(items[0].command?.command, "pdp.openTask");
  }).timeout(20000);

  test("a run marks model running while its script sleeps, then clears", async () => {
    await pdp.exec(["clean"]);
    await vscode.commands.executeCommand("pdp.refresh");
    const view = graphView!;
    const originalUpdate = view.update;
    const seen = new Set<string>();
    let last: ReadonlySet<string> | undefined;
    view.update = (status, running) => {
      running?.forEach((id) => seen.add(id));
      last = running;
      originalUpdate.call(view, status, running);
    };
    try {
      await vscode.commands.executeCommand("pdp.runAll");
    } finally {
      view.update = originalUpdate;
    }
    assert.ok(seen.has("model"), `running seen: ${[...seen]}`);
    assert.deepStrictEqual(
      [...(last ?? [])],
      [],
      "running state outlived the run",
    );
  }).timeout(20000);

  test("clean returns every task to stale", async () => {
    const res = await pdp.exec(["clean"]);
    assert.strictEqual(res.code, 0);
    const status = await pdp.status();
    assert.ok(status.tasks.every((task) => task.stale));
  });

  test("run to a task includes its stale upstream; run only refuses", async () => {
    await pdp.exec(["clean"]);
    const only = await pdp.spawnPdp(["run", "clean", "--only"]).done;
    assert.notStrictEqual(only.code, 0);

    const to = await pdp.spawnPdp(["run", "--to", "clean"]).done;
    assert.strictEqual(to.code, 0);
    const report = pdp.reportFromOutput(to.stdout, to.stderr);
    assert.deepStrictEqual(report.ran, ["import", "clean"]);

    const status = await pdp.status();
    assert.strictEqual(
      status.tasks.find((task) => task.id === "report")?.stale,
      true,
    );
  });

  test("commands dispatched with a task id string do not re-prompt", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    await vscode.commands.executeCommand("pdp.openTask", "clean");
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "openTask did not open a document");
    assert.match(
      editor.document.uri.fsPath,
      /clean[/\\]task\.yml$/,
      `expected clean/task.yml, got ${editor.document.uri.fsPath}`,
    );
  });

  test("freshen marks a stale task fresh without running it", async () => {
    await pdp.spawnPdp(["run", "--to", "clean"]).done;
    // a "code" change (task-root file newer than the output) makes import stale
    const makefile = path.join(pdp.workspaceRoot()!, "import", "Makefile");
    const now = new Date();
    fs.utimesSync(makefile, now, now);
    let status = await pdp.status();
    assert.strictEqual(
      status.tasks.find((task) => task.id === "import")?.stale,
      true,
    );

    const res = await pdp.exec(["freshen", "import", "--only"]);
    assert.strictEqual(res.code, 0);
    assert.deepStrictEqual(parseFreshen(res.stdout, res.stderr), {
      freshened: ["import"],
      stillStale: [],
      newlyStale: ["clean"],
    });

    status = await pdp.status();
    assert.strictEqual(
      status.tasks.find((task) => task.id === "import")?.stale,
      false,
    );
    assert.strictEqual(
      status.tasks.find((task) => task.id === "clean")?.stale,
      true,
    );
  });

  test("freshen reports tasks that stay stale instead of failing silently", async () => {
    await pdp.spawnPdp(["run", "--to", "clean"]).done;
    const makefile = path.join(pdp.workspaceRoot()!, "import", "Makefile");
    // an input dated in the future stays newer than anything freshen writes
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(makefile, future, future);

    const res = await pdp.exec(["freshen", "import", "--only"]);
    assert.strictEqual(res.code, 1);
    assert.deepStrictEqual(parseFreshen(res.stdout, res.stderr), {
      freshened: [],
      stillStale: ["import"],
      newlyStale: ["clean"],
    });

    // leave the fixture runnable for later tests
    fs.utimesSync(makefile, new Date(0), new Date(0));
  });

  test("tasks tree shows pdp.yml, then each task's folder; details stay in task.yml", async () => {
    await pdp.spawnPdp(["run", "--to", "clean"]).done;
    const provider = new PdpTasksProvider();
    provider.update(await pdp.status());
    const [pdpYml, ...tasks] = await provider.getChildren();
    assert.ok(pdpYml instanceof FileItem);
    assert.strictEqual(pdpYml.label, "pdp.yml");

    const clean = tasks.find((item) => item.label === "clean")!;
    const children = await provider.getChildren(clean);
    assert.ok(
      children.every((item) => item instanceof FileItem),
      `expected folder files only, got ${children.map((item) => item.label)}`,
    );
    assert.deepStrictEqual(
      children.map((item) => item.label),
      ["input", "output", "src", "Makefile", "task.yml"],
    );

    const output = children.find((item) => item.label === "output")!;
    const files = await provider.getChildren(output);
    assert.deepStrictEqual(
      files.map((item) => item.label),
      ["done.txt"],
    );
    assert.strictEqual(files[0].command?.command, "vscode.open");
  });

  test("view focus commands run", async () => {
    for (const view of ["pdp.tasks", "pdp.graph", "pdp.remote"]) {
      await vscode.commands.executeCommand(`${view}.focus`);
    }
  });

  test("task keys act on the tree's task without a picker", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    assert.ok(tasksTree, "tasks tree not registered");
    const provider = new PdpTasksProvider();
    provider.update(await pdp.status());
    const rows = await provider.getChildren();
    const clean = rows.find(
      (item) => item instanceof TaskItem && item.label === "clean",
    )!;
    const originalPick = vscode.window.showQuickPick;
    const originalWarn = vscode.window.showWarningMessage;
    let picks = 0;
    const prompts: string[] = [];
    vscode.window.showQuickPick = (async () => {
      picks += 1;
      return undefined;
    }) as unknown as typeof vscode.window.showQuickPick;
    vscode.window.showWarningMessage = (async (message: string) => {
      prompts.push(message);
      return undefined;
    }) as typeof vscode.window.showWarningMessage;
    try {
      await tasksTree!.reveal(clean, { select: true, focus: true });
      await vscode.commands.executeCommand("pdp.runTaskConfirm", {
        selected: true,
      });
      assert.deepStrictEqual(prompts, ['Run "clean"?']);
      assert.strictEqual(picks, 0, "a task row must not open the picker");

      // pdp.yml names no task, so the picker is the way to choose one.
      await tasksTree!.reveal(rows[0], { select: true, focus: true });
      await vscode.commands.executeCommand("pdp.runTaskConfirm", {
        selected: true,
      });
      assert.strictEqual(picks, 1);
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.window.showWarningMessage = originalWarn;
    }
  });

  test("commands dispatched with an unknown or flag-like task id do nothing", async () => {
    const before = vscode.window.activeTextEditor?.document.uri.fsPath;
    await vscode.commands.executeCommand("pdp.refresh");
    await vscode.commands.executeCommand("pdp.openTask", "nope");
    await vscode.commands.executeCommand("pdp.openTask", "--force");
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      before,
      "no task document should have opened",
    );
  });

  test("package.json carries the tasks view keybindings exactly", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    assert.ok(ext, "extension not found");
    const bindings = ext.packageJSON.contributes.keybindings as {
      command: string;
      key: string;
      when: string;
      args?: unknown;
    }[];
    // [key, command, task-scoped]: task-scoped bindings carry { selected: true }.
    const taskBindings = [
      ["r", "pdp.runTaskConfirm", true],
      ["c", "pdp.cleanTaskConfirm", true],
      ["t", "pdp.openTask", true],
      ["shift+t", "pdp.createTaskYml", true],
      ["f", "pdp.freshenTask", true],
      ["d", "pdp.deleteTask", true],
      ["s", "pdp.openTaskSrc", true],
      ["m", "pdp.openTaskMakefile", true],
      ["shift+m", "pdp.createTaskMakefile", true],
      ["shift+s", "pdp.createTaskSrc", true],
      ["shift+r", "pdp.runAllConfirm", false],
      ["shift+c", "pdp.cleanAllConfirm", false],
    ] as const;
    for (const [key, command, taskScoped] of taskBindings) {
      const binding = bindings.find((b) => b.command === command);
      assert.ok(binding, `no keybinding for ${command}`);
      assert.strictEqual(binding.key, key, `${command} key`);
      assert.strictEqual(
        binding.when,
        "focusedView == pdp.tasks && !terminalFocus",
        `${command} when`,
      );
      assert.deepStrictEqual(
        binding.args,
        taskScoped ? { selected: true } : undefined,
        command,
      );
    }
  });

  test("openTaskSrc handles zero, one and many source files", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    const src = path.join(pdp.workspaceRoot()!, "import", "src");
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300)); // let the watcher see the files
    const write = (...names: string[]) => {
      fs.mkdirSync(src, { recursive: true });
      for (const name of names) {
        fs.writeFileSync(path.join(src, name), "x = 1\n");
      }
    };

    const originalInfo = vscode.window.showInformationMessage;
    const originalPick = vscode.window.showQuickPick;
    try {
      fs.rmSync(src, { recursive: true, force: true });
      await settle();
      const infos: string[] = [];
      vscode.window.showInformationMessage = ((
        message: string,
        ...rest: unknown[]
      ) => {
        infos.push(message);
        return Promise.resolve(undefined);
      }) as typeof vscode.window.showInformationMessage;
      await vscode.commands.executeCommand("pdp.openTaskSrc", "import");
      assert.deepStrictEqual(infos, ["pdp: No files in import/src"]);

      infos.length = 0;
      write("a.py");
      await settle();
      await vscode.commands.executeCommand("pdp.openTaskSrc", "import");
      assert.deepStrictEqual(infos, []);
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /import[/\\]src[/\\]a\.py$/,
      );

      write("b.py");
      await settle();
      // The QuickPick returns its second item, so b.py must open.
      vscode.window.showQuickPick = (async (items: readonly unknown[]) =>
        (
          items as { uri: vscode.Uri }[]
        )[1]) as unknown as typeof vscode.window.showQuickPick;
      await vscode.commands.executeCommand("pdp.openTaskSrc", "import");
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /import[/\\]src[/\\]b\.py$/,
      );
    } finally {
      vscode.window.showInformationMessage = originalInfo;
      vscode.window.showQuickPick = originalPick;
      // The make target runs src/main.sh, so the fixture must keep it.
      fs.rmSync(src, { recursive: true, force: true });
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(
        path.join(src, "main.sh"),
        "#!/bin/sh\nmkdir -p output\ntouch output/data.csv\n",
      );
    }
  });

  test("confirm commands run the target only when the modal says yes", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    const originalWarn = vscode.window.showWarningMessage;
    const originalExecute = vscode.commands.executeCommand;
    const ran: unknown[][] = [];
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command === "pdp.runTask") {
        ran.push(args);
        return Promise.resolve(undefined);
      }
      return originalExecute(command, ...args);
    }) as typeof vscode.commands.executeCommand;
    try {
      vscode.window.showWarningMessage = (async () =>
        undefined) as typeof vscode.window.showWarningMessage;
      await vscode.commands.executeCommand("pdp.runTaskConfirm", "import");
      assert.deepStrictEqual(ran, [], "dismissed modal still ran the task");

      vscode.window.showWarningMessage = (async () =>
        "Run") as typeof vscode.window.showWarningMessage;
      await vscode.commands.executeCommand("pdp.runTaskConfirm", "import");
      assert.deepStrictEqual(ran, [["import"]]);
    } finally {
      vscode.window.showWarningMessage = originalWarn;
      vscode.commands.executeCommand = originalExecute;
    }
  });

  test("runAllConfirm and cleanAllConfirm run only when the modal says yes", async () => {
    const originalWarn = vscode.window.showWarningMessage;
    const originalExecute = vscode.commands.executeCommand;
    const ran: string[] = [];
    let answer: string | undefined;
    vscode.window.showWarningMessage = (async () =>
      answer) as typeof vscode.window.showWarningMessage;
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command === "pdp.runAll" || command === "pdp.cleanAll") {
        ran.push(command);
        return Promise.resolve(undefined);
      }
      return originalExecute(command, ...args);
    }) as typeof vscode.commands.executeCommand;
    try {
      await vscode.commands.executeCommand("pdp.runAllConfirm");
      await vscode.commands.executeCommand("pdp.cleanAllConfirm");
      assert.deepStrictEqual(ran, [], "dismissed modals still ran");

      answer = "Run all";
      await vscode.commands.executeCommand("pdp.runAllConfirm");
      answer = "Clean all";
      await vscode.commands.executeCommand("pdp.cleanAllConfirm");
      assert.deepStrictEqual(ran, ["pdp.runAll", "pdp.cleanAll"]);
    } finally {
      vscode.window.showWarningMessage = originalWarn;
      vscode.commands.executeCommand = originalExecute;
    }
  });

  test("openTaskMakefile opens the Makefile or explains its absence", async () => {
    const makefile = path.join(pdp.workspaceRoot()!, "clean", "Makefile");
    const originalInfo = vscode.window.showInformationMessage;
    const infos: string[] = [];
    vscode.window.showInformationMessage = ((message: string) => {
      infos.push(message);
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;
    try {
      await vscode.commands.executeCommand("pdp.openTaskMakefile", "clean");
      assert.deepStrictEqual(infos, []);
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /clean[/\\]Makefile$/,
      );

      fs.rmSync(makefile);
      await vscode.commands.executeCommand("pdp.openTaskMakefile", "clean");
      assert.deepStrictEqual(infos, ["pdp: No Makefile for clean"]);
    } finally {
      fs.writeFileSync(makefile, "clean:\n\tbash src/main.sh\n");
      vscode.window.showInformationMessage = originalInfo;
    }
  });

  test("createTaskMakefile opens existing, prompts before creating", async () => {
    const makefile = path.join(pdp.workspaceRoot()!, "clean", "Makefile");
    const originalWarn = vscode.window.showWarningMessage;
    let answer: string | undefined;
    let prompts = 0;
    vscode.window.showWarningMessage = (async () => {
      prompts += 1;
      return answer;
    }) as typeof vscode.window.showWarningMessage;
    try {
      // Existing Makefile: open it, no prompt.
      await vscode.commands.executeCommand("pdp.createTaskMakefile", "clean");
      assert.strictEqual(prompts, 0);
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /clean[/\\]Makefile$/,
      );

      // Missing Makefile, dismissed prompt: nothing is written.
      fs.rmSync(makefile);
      await vscode.commands.executeCommand("pdp.createTaskMakefile", "clean");
      assert.strictEqual(prompts, 1);
      assert.ok(!fs.existsSync(makefile));

      // Missing Makefile, accepted prompt: the stub is written and opened.
      answer = "Create";
      await vscode.commands.executeCommand("pdp.createTaskMakefile", "clean");
      assert.strictEqual(prompts, 2);
      assert.strictEqual(
        fs.readFileSync(makefile, "utf8"),
        "clean:\n\tbash src/main.sh\n",
      );
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /clean[/\\]Makefile$/,
      );
    } finally {
      fs.writeFileSync(makefile, "clean:\n\tbash src/main.sh\n");
      vscode.window.showWarningMessage = originalWarn;
    }
  });

  test("createTaskYml opens existing, prompts before creating", async () => {
    const taskYml = path.join(pdp.workspaceRoot()!, "clean", "task.yml");
    const original = fs.readFileSync(taskYml, "utf8");
    const originalWarn = vscode.window.showWarningMessage;
    let answer: string | undefined;
    let prompts = 0;
    vscode.window.showWarningMessage = (async () => {
      prompts += 1;
      return answer;
    }) as typeof vscode.window.showWarningMessage;
    try {
      // Existing task.yml: open it, no prompt.
      await vscode.commands.executeCommand("pdp.createTaskYml", "clean");
      assert.strictEqual(prompts, 0);
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /clean[/\\]task\.yml$/,
      );

      // Missing task.yml, dismissed prompt: nothing is written.
      fs.rmSync(taskYml);
      await vscode.commands.executeCommand("pdp.createTaskYml", "clean");
      assert.strictEqual(prompts, 1);
      assert.ok(!fs.existsSync(taskYml));

      // Missing task.yml, accepted prompt: pdp create's stub is written.
      answer = "Create";
      await vscode.commands.executeCommand("pdp.createTaskYml", "clean");
      assert.strictEqual(prompts, 2);
      assert.strictEqual(
        fs.readFileSync(taskYml, "utf8"),
        "name: clean\nentrypoint: ''\ndepends_on: []\n",
      );
    } finally {
      fs.writeFileSync(taskYml, original);
      vscode.window.showWarningMessage = originalWarn;
    }
  });

  test("createTaskSrc opens existing files and creates main.sh when src is empty", async () => {
    const src = path.join(pdp.workspaceRoot()!, "import", "src");
    const mainSh = path.join(src, "main.sh");
    const originalWarn = vscode.window.showWarningMessage;
    let answer: string | undefined;
    let prompts = 0;
    vscode.window.showWarningMessage = (async () => {
      prompts += 1;
      return answer;
    }) as typeof vscode.window.showWarningMessage;
    try {
      // Existing src files: open them, no prompt.
      await vscode.commands.executeCommand("pdp.createTaskSrc", "import");
      assert.strictEqual(prompts, 0);
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /import[/\\]src[/\\]main\.sh$/,
      );

      // Empty src, dismissed prompt: nothing is written.
      fs.rmSync(mainSh);
      await vscode.commands.executeCommand("pdp.createTaskSrc", "import");
      assert.strictEqual(prompts, 1);
      assert.ok(!fs.existsSync(mainSh));

      // Empty src, accepted prompt: the stub is written and opened.
      answer = "Create";
      await vscode.commands.executeCommand("pdp.createTaskSrc", "import");
      assert.strictEqual(prompts, 2);
      assert.strictEqual(
        fs.readFileSync(mainSh, "utf8"),
        "#!/bin/sh\nmkdir -p output\ntouch output/done.txt\n",
      );
      assert.match(
        vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
        /import[/\\]src[/\\]main\.sh$/,
      );
    } finally {
      fs.writeFileSync(
        mainSh,
        "#!/bin/sh\nmkdir -p output\ntouch output/data.csv\n",
      );
      vscode.window.showWarningMessage = originalWarn;
    }
  });

  test("showShortcuts with 'tasks' lists the tasks keys only", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    type ShortcutItem = { label: string; description?: string };
    let items: ShortcutItem[] = [];
    const originalPick = vscode.window.showQuickPick;
    const originalExecute = vscode.commands.executeCommand;
    const ran: { command: string; args: unknown[] }[] = [];
    vscode.window.showQuickPick = (async (list: readonly unknown[]) => {
      items = list as ShortcutItem[];
      return items.find((item) => item.label === "r");
    }) as unknown as typeof vscode.window.showQuickPick;
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command.startsWith("pdp.") && command !== "pdp.showShortcuts") {
        ran.push({ command, args });
        return Promise.resolve(undefined);
      }
      return originalExecute(command, ...args);
    }) as typeof vscode.commands.executeCommand;
    try {
      await vscode.commands.executeCommand("pdp.showShortcuts", "tasks");
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.commands.executeCommand = originalExecute;
    }
    const keys = items.map((item) => String(item.label));
    for (const key of [
      "Enter",
      "r",
      "c",
      "t",
      "T",
      "f",
      "d",
      "s",
      "m",
      "M",
      "S",
      "R",
      "C",
    ]) {
      assert.ok(keys.includes(key), `missing tasks key ${key}`);
    }
    for (const graphKey of ["i", "o", "l"]) {
      assert.ok(!keys.includes(graphKey), `graph key ${graphKey} leaked in`);
    }
    // Picking the r entry runs its command against the tree selection.
    assert.deepStrictEqual(ran, [
      { command: "pdp.runTaskConfirm", args: [{ selected: true }] },
    ]);
  });

  test("package.json binds ? to the cheat sheet in each view", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    const bindings = ext?.packageJSON.contributes.keybindings as {
      command: string;
      key: string;
      when: string;
      args?: unknown;
    }[];
    const show = bindings.filter(
      (binding) => binding.command === "pdp.showShortcuts",
    );
    assert.deepStrictEqual(show, [
      {
        command: "pdp.showShortcuts",
        key: "shift+/",
        when: "pdp.graphFocused && !terminalFocus",
        args: "graph",
      },
      {
        command: "pdp.showShortcuts",
        key: "shift+/",
        when: "focusedView == pdp.tasks && !terminalFocus",
        args: "tasks",
      },
    ]);
  });

  test("rerunLast replays the last run; nothing recorded is explained", async () => {
    await vscode.commands.executeCommand("pdp.refresh");
    lastRunTracker.lastRun = null;
    const originalInfo = vscode.window.showInformationMessage;
    const originalSpawn = pdp.spawnPdp;
    const infos: string[] = [];
    const spawned: string[][] = [];
    vscode.window.showInformationMessage = ((message: string) => {
      infos.push(message);
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showInformationMessage;
    (pdp as { spawnPdp: typeof pdp.spawnPdp }).spawnPdp = (args: string[]) => {
      spawned.push(args);
      return {
        done: Promise.resolve({ code: 0, stdout: "", stderr: "" }),
        kill: () => undefined,
      };
    };
    try {
      await vscode.commands.executeCommand("pdp.rerunLast");
      assert.deepStrictEqual(infos, ["pdp: No run yet this session"]);
      assert.deepStrictEqual(spawned, [], "a run happened without a record");

      await vscode.commands.executeCommand("pdp.runTask", "import");
      assert.deepStrictEqual(lastRunTracker.lastRun, {
        args: ["import"],
        title: "pdp: Run import",
      });
      await vscode.commands.executeCommand("pdp.rerunLast");
      assert.deepStrictEqual(spawned, [
        ["run", "import"],
        ["run", "import"],
      ]);
    } finally {
      vscode.window.showInformationMessage = originalInfo;
      (pdp as { spawnPdp: typeof pdp.spawnPdp }).spawnPdp = originalSpawn;
      lastRunTracker.lastRun = null;
    }
  });

  test("package.json binds alt+p . to rerunLast", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    const bindings = ext?.packageJSON.contributes.keybindings as {
      command: string;
      key: string;
      when: string;
    }[];
    const binding = bindings.find((b) => b.command === "pdp.rerunLast");
    assert.deepStrictEqual(binding, {
      command: "pdp.rerunLast",
      key: "alt+p .",
      when: "pdp.hasProject && !terminalFocus",
    });
  });

  test("package.json binds alt+p t to focus Tasks", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    const bindings = ext?.packageJSON.contributes.keybindings as {
      command: string;
      key: string;
      when: string;
    }[];
    const binding = bindings.find(
      (b) => b.command === "pdp.tasks.focus" && b.key === "alt+p t",
    );
    assert.deepStrictEqual(binding, {
      command: "pdp.tasks.focus",
      key: "alt+p t",
      when: "!terminalFocus",
    });
  });

  test("the task picker defaults to the tree's selection context", async () => {
    await pdp.spawnPdp(["run", "--to", "clean"]).done;
    await settleWatcher();
    await vscode.commands.executeCommand("pdp.refresh");
    assert.ok(tasksTree, "tasks tree not registered");
    const provider = new PdpTasksProvider();
    provider.update(await pdp.status());
    // clean is not first in status order, so a moved default is detectable.
    const cleanItem = (await provider.getChildren()).find(
      (item) => item instanceof TaskItem && item.label === "clean",
    ) as TaskItem;
    const taskYml = (await provider.getChildren(cleanItem)).find(
      (item) => item instanceof FileItem && item.label === "task.yml",
    ) as FileItem;
    // A file row inside clean: its owner is the default the picker opens on.
    await tasksTree!.reveal(taskYml, { select: true });

    type PickItem = { label: string; task: pdp.TaskStatus };
    let pickerItems: PickItem[] = [];
    const originalPick = vscode.window.showQuickPick;
    const originalExecute = vscode.commands.executeCommand;
    const revealed: string[] = [];
    vscode.window.showQuickPick = (async (list: readonly unknown[]) => {
      pickerItems = list as PickItem[];
      return pickerItems[0];
    }) as unknown as typeof vscode.window.showQuickPick;
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command === "revealInExplorer") {
        revealed.push(String((args[0] as vscode.Uri).fsPath));
        return Promise.resolve(undefined);
      }
      return originalExecute(command, ...args);
    }) as typeof vscode.commands.executeCommand;
    try {
      await vscode.commands.executeCommand("pdp.revealTask");
    } finally {
      vscode.window.showQuickPick = originalPick;
      vscode.commands.executeCommand = originalExecute;
    }
    assert.strictEqual(pickerItems[0]?.label, "clean");
    assert.deepStrictEqual(
      pickerItems.slice(1).map((item) => item.label),
      ["import", "filter", "explore", "model", "report"],
    );
    assert.strictEqual(revealed.length, 1);
    assert.match(revealed[0], /[/\\]clean$/);

    // A directly selected task row is still the default (no regression).
    await tasksTree!.reveal(cleanItem, { select: true });
    pickerItems = [];
    const originalPickAgain = vscode.window.showQuickPick;
    vscode.window.showQuickPick = (async (list: readonly unknown[]) => {
      pickerItems = list as PickItem[];
      return pickerItems[0];
    }) as unknown as typeof vscode.window.showQuickPick;
    try {
      await vscode.commands.executeCommand("pdp.revealTask");
    } finally {
      vscode.window.showQuickPick = originalPickAgain;
    }
    assert.strictEqual(pickerItems[0]?.label, "clean");
  }).timeout(10000);

  test("the sidebar views ship with their initial proportions", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    const views = ext?.packageJSON.contributes.views.pdp as Record<
      string,
      unknown
    >[];
    const byId = new Map(views.map((view) => [String(view.id), view]));
    assert.deepStrictEqual(byId.get("pdp.tasks")?.["initialSize"], 1);
    assert.deepStrictEqual(byId.get("pdp.graph")?.["initialSize"], 3);
    assert.deepStrictEqual(byId.get("pdp.remote")?.["visibility"], "collapsed");
    assert.ok(
      !("initialSize" in (byId.get("pdp.remote") ?? {})),
      "pdp.remote must not set initialSize",
    );
  });
});
