import * as assert from "assert";
import * as vscode from "vscode";
import {
  MIN_PDP_VERSION,
  parseReport,
  parseStatus,
  reportFromOutput,
  reportSummary,
  versionAtLeast,
} from "../pdp";
import { PdpTasksProvider, TaskItem } from "../tasksView";

suite("pdp parsing", () => {
  test("versionAtLeast compares 3-part versions", () => {
    assert.ok(versionAtLeast("0.2.4", MIN_PDP_VERSION));
    assert.ok(versionAtLeast("1.0.0", MIN_PDP_VERSION));
    assert.ok(versionAtLeast("pdp, version 0.3.0", MIN_PDP_VERSION));
    assert.ok(!versionAtLeast("0.2.3", MIN_PDP_VERSION));
    assert.ok(!versionAtLeast("0.2", MIN_PDP_VERSION));
    assert.ok(!versionAtLeast("garbage", MIN_PDP_VERSION));
  });

  test("parseStatus reads project and tasks in order", () => {
    const status = parseStatus(
      JSON.stringify({
        project: "demo",
        tasks: [
          {
            id: "fetch",
            stale: true,
            depends_on: [],
            description: "",
            entrypoint: "make",
            slurm: {},
          },
          {
            id: "clean",
            stale: false,
            depends_on: ["fetch"],
            description: "tidy up",
            entrypoint: "make",
            slurm: { mem: "16G" },
          },
        ],
      }),
    );
    assert.strictEqual(status.project, "demo");
    assert.deepStrictEqual(
      status.tasks.map((t) => t.id),
      ["fetch", "clean"],
    );
    assert.strictEqual(status.tasks[1].stale, false);
    assert.deepStrictEqual(status.tasks[1].depends_on, ["fetch"]);
    assert.deepStrictEqual(status.tasks[1].slurm, { mem: "16G" });
  });

  test("parseStatus rejects non-task JSON", () => {
    assert.throws(() => parseStatus('{"project": "x"}'));
    assert.throws(() => parseStatus("not json"));
  });

  test("parseReport reads all report lines", () => {
    const stdout = [
      "fetch output",
      "Ran: fetch, clean",
      "Wrote:",
      "  fetch/output/data.txt",
      "Current: report",
      "",
    ].join("\n");
    const stderr = [
      "Ran but wrote nothing to output/: lint",
      "Failed: build",
      "No entrypoint (failed): seed",
      "Skipped (upstream failed): train",
    ].join("\n");
    const report = reportFromOutput(stdout, stderr);
    assert.deepStrictEqual(report.ran, ["fetch", "clean"]);
    assert.deepStrictEqual(report.current, ["report"]);
    assert.deepStrictEqual(report.noOutput, ["lint"]);
    assert.deepStrictEqual(report.failed, ["build"]);
    assert.deepStrictEqual(report.noEntrpoint, ["seed"]);
    assert.deepStrictEqual(report.skipped, ["train"]);
  });

  test("parseReport ignores report-like task output before the block", () => {
    const text = [
      "some task output",
      "Failed: 0 assertions",
      "",
      "Ran: fetch",
    ].join("\n");
    const report = parseReport(text);
    assert.deepStrictEqual(report.ran, ["fetch"]);
    assert.deepStrictEqual(report.failed, []);
  });

  test("reportFromOutput joins stdout and stderr halves", () => {
    const stdout = "task output\nRan: fetch\n";
    const stderr = "Failed: build\n";
    const report = reportFromOutput(stdout, stderr);
    assert.deepStrictEqual(report.ran, ["fetch"]);
    assert.deepStrictEqual(report.failed, ["build"]);
  });

  test("reportSummary lists counts and names", () => {
    assert.strictEqual(
      reportSummary({
        ran: [],
        current: [],
        failed: [],
        noEntrpoint: [],
        skipped: [],
        noOutput: [],
      }),
      "nothing to run",
    );
    assert.match(
      reportSummary({
        ran: ["fetch"],
        current: [],
        failed: ["build"],
        noEntrpoint: [],
        skipped: [],
        noOutput: [],
      }),
      /ran: fetch.*failed: build/,
    );
  });
});

suite("tasks view", () => {
  const status = parseStatus(
    JSON.stringify({
      project: "demo",
      tasks: [
        {
          id: "fetch",
          stale: true,
          depends_on: [],
          description: "",
          entrypoint: "",
          slurm: {},
        },
        {
          id: "clean",
          stale: false,
          depends_on: ["fetch"],
          description: "tidy up",
          entrypoint: "make",
          slurm: { mem: "16G" },
        },
      ],
    }),
  );

  test("root children are task items in status order", async () => {
    const provider = new PdpTasksProvider();
    assert.deepStrictEqual(await provider.getChildren(), []);
    provider.update(status);
    const children = await provider.getChildren();
    assert.strictEqual(children.length, 2);
    const [fetch, clean] = children as TaskItem[];
    assert.ok(fetch instanceof TaskItem);
    assert.strictEqual(fetch.label, "fetch");
    assert.strictEqual(fetch.description, "stale");
    assert.strictEqual(fetch.contextValue, "task");
    assert.ok(fetch.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual(fetch.command?.command, "pdp.openTask");
    assert.strictEqual(clean?.description, "fresh · tidy up");
  });

  test("task children show depends on, entrypoint and slurm", async () => {
    const provider = new PdpTasksProvider();
    provider.update(status);
    const [, clean] = (await provider.getChildren()) as TaskItem[];
    const details = (await provider.getChildren(clean)).map(
      (item) => item.description ?? item.label,
    );
    assert.deepStrictEqual(details, [
      "depends on: fetch",
      "entrypoint: make",
      "slurm: mem 16G",
    ]);
  });

  test("task without detail has no children and no expand", async () => {
    const provider = new PdpTasksProvider();
    provider.update(status);
    const [fetch] = (await provider.getChildren()) as TaskItem[];
    assert.strictEqual(
      fetch.collapsibleState,
      vscode.TreeItemCollapsibleState.None,
    );
    assert.deepStrictEqual(await provider.getChildren(fetch), []);
  });
});
