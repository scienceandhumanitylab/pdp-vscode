import * as assert from "assert";
import * as vscode from "vscode";
import { graphView } from "../extension";
import {
  mermaidDefinition,
  nodeLabels,
  PdpGraphViewProvider,
} from "../graphView";
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

  test("each task is a node labelled with a short state marker", () => {
    const def = mermaidDefinition(status);
    assert.match(def, /\bn0\["fetch ✗"\]:::stale/);
    assert.match(def, /\bn1\["clean ✓"\]:::fresh/);
    assert.match(def, /\bn2\["report ✗"\]:::stale/);
  });

  test("nodeLabels carries the full state for hover titles", () => {
    assert.deepStrictEqual(nodeLabels(status), [
      "fetch (stale)",
      "clean (fresh)",
      "report (stale)",
    ]);
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

  test("a taskMenu message maps the node back to its id, and the render carries the font size setting", async () => {
    const opened: string[] = [];
    const menus: string[] = [];
    const posted: { type: string; labels?: string[]; fontSize?: number }[] = [];
    const listeners: Array<(message: unknown) => void> = [];
    const view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          listeners.push(listener);
          return { dispose: () => undefined };
        },
        postMessage: (message: {
          type: string;
          labels?: string[];
          fontSize?: number;
        }) => {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewView;
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      (id) => opened.push(id),
      (id) => menus.push(id),
    );

    provider.resolveWebviewView(view);
    provider.update(status);
    listeners.forEach((listener) => listener({ type: "taskMenu", node: "n1" }));

    assert.deepStrictEqual(menus, ["clean"]);
    assert.deepStrictEqual(opened, []);
    const render = posted.find((message) => message.type === "render");
    assert.deepStrictEqual(render?.labels, nodeLabels(status));
    assert.strictEqual(render?.fontSize, 14, "expected the default font size");

    const config = vscode.workspace.getConfiguration("pdp");
    await config.update("graphFontSize", 20, vscode.ConfigurationTarget.Global);
    try {
      // No manual update(): the config listener must re-render on its own.
      const deadline = Date.now() + 2000;
      let reRendered: number | undefined;
      while (Date.now() < deadline) {
        reRendered = posted.filter((m) => m.type === "render").at(-1)?.fontSize;
        if (reRendered === 20) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.strictEqual(reRendered, 20, "config change did not re-render");
    } finally {
      await config.update(
        "graphFontSize",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
    provider.dispose();
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
