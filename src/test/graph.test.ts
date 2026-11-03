import * as assert from "assert";
import * as vscode from "vscode";
import { graphView } from "../extension";
import { mermaidDefinition } from "../graphView";
import { parseStatus } from "../pdp";

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
        description: "",
        entrypoint: "make",
        slurm: {},
      },
      {
        id: "report",
        stale: true,
        depends_on: ["clean"],
        description: "",
        entrypoint: "make",
        slurm: {},
      },
    ],
  }),
);

suite("graph", () => {
  test("mermaid definition is a top-to-bottom flowchart", () => {
    const def = mermaidDefinition(status);
    assert.ok(def.startsWith("flowchart TD"));
    assert.match(def, /classDef stale/);
    assert.match(def, /classDef fresh/);
  });

  test("each task is a node labelled with its state", () => {
    const def = mermaidDefinition(status);
    assert.match(def, /\bn0\["fetch \(stale\)"\]:::stale/);
    assert.match(def, /\bn1\["clean \(fresh\)"\]:::fresh/);
    assert.match(def, /\bn2\["report \(stale\)"\]:::stale/);
  });

  test("dependencies become edges from upstream to downstream", () => {
    const def = mermaidDefinition(status);
    assert.match(def, /\bn0 --> n1\b/);
    assert.match(def, /\bn1 --> n2\b/);
    assert.ok(!/\bn2 -->/.test(def));
  });

  test("unknown dependencies are skipped", () => {
    const status = parseStatus(
      JSON.stringify({
        project: "demo",
        tasks: [
          {
            id: "a",
            stale: true,
            depends_on: ["ghost"],
            description: "",
            entrypoint: "",
            slurm: {},
          },
        ],
      }),
    );
    const def = mermaidDefinition(status);
    assert.doesNotMatch(def, /-->/);
  });

  test("graph view renders the graph with mermaid", async () => {
    const ext = vscode.extensions.getExtension("scienceandhumanitylab.pdp");
    assert.ok(ext, "extension not found");
    await ext.activate();
    await vscode.commands.executeCommand("pdp.graph.focus");
    assert.ok(graphView, "graph view not registered");
    graphView.update(status);
    const rendered = await Promise.race([
      graphView.rendered,
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 15000),
      ),
    ]);
    assert.ok(rendered, "webview view did not render the graph in time");
  }).timeout(20000);
});
