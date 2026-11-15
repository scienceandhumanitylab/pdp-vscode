import * as assert from "assert";
import * as vscode from "vscode";
import * as pdp from "../pdp";
import { FileItem, PdpTasksProvider, TaskItem } from "../tasksView";

// Runs against the real pdp binary in src/test/fixtures/demo, which the
// test workspace opens (see .vscode-test.mjs).
suite("fixture integration", () => {
  test("status parses the demo project in topological order", async () => {
    const status = await pdp.status();
    assert.strictEqual(status.project, "demo");
    assert.deepStrictEqual(
      status.tasks.map((task) => task.id),
      ["import", "clean", "filter", "explore", "model", "report"],
    );
  });

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
  });

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

  test("tasks tree shows pdp.yml, then each task's details and folder", async () => {
    await pdp.spawnPdp(["run", "--to", "clean"]).done;
    const provider = new PdpTasksProvider();
    provider.update(await pdp.status());
    const [pdpYml, ...tasks] = await provider.getChildren();
    assert.ok(pdpYml instanceof FileItem);
    assert.strictEqual(pdpYml.label, "pdp.yml");

    const clean = tasks.find((item) => item.label === "clean")!;
    const children = await provider.getChildren(clean);
    const [dependsOn, entrypoint, ...entries] = children;
    assert.strictEqual(dependsOn.label, "depends on: import");
    assert.strictEqual(entrypoint.label, "entrypoint: make");
    assert.deepStrictEqual(
      entries.map((item) => item.label),
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
});
