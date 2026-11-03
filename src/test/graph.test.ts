import * as assert from "assert";
import * as vscode from "vscode";
import { mermaidDefinition, PdpGraphPanel } from "../graph";
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
  test("mermaid definition is a left-to-right flowchart", () => {
    const def = mermaidDefinition(status);
    assert.ok(def.startsWith("flowchart LR"));
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

  test("webview renders the graph with mermaid", async () => {
    const ext = vscode.extensions.getExtension("scienceandhumanitylab.pdp");
    assert.ok(ext, "extension not found");
    const panel = PdpGraphPanel.show(ext.extensionUri, status, () => undefined);
    const rendered = await Promise.race([
      panel.rendered,
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 15000),
      ),
    ]);
    panel.dispose();
    assert.ok(rendered, "webview did not render the graph in time");
  }).timeout(20000);
});
