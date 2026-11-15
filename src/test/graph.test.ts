import * as assert from "assert";
import * as vscode from "vscode";
import { graphView } from "../extension";
import {
  graphElements,
  nodeLabels,
  PdpGraphViewProvider,
  positionsKey,
} from "../graphView";
import { parseStatus, workspaceRoot } from "../pdp";

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
  test("graphElements builds nodes in status order with state markers", () => {
    const nodes = graphElements(status, {}).filter(
      (element) => element.group === "nodes",
    );
    assert.deepStrictEqual(
      nodes.map((node) => node.data.id),
      ["n0", "n1", "n2"],
    );
    assert.deepStrictEqual(
      nodes.map((node) => node.data.label),
      ["fetch ✗", "clean ✓", "report ✗"],
    );
    assert.deepStrictEqual(
      nodes.map((node) => node.classes),
      ["stale", "fresh", "stale"],
    );
    assert.ok(
      nodes.every((node) => node.position === undefined),
      "no position without saved ones",
    );
  });

  test("graphElements attaches saved positions and keeps edges upstream to downstream", () => {
    const elements = graphElements(status, { fetch: { x: 1, y: 2 } });
    assert.deepStrictEqual(elements[0].position, { x: 1, y: 2 });
    const edges = elements.filter((element) => element.group === "edges");
    assert.deepStrictEqual(
      edges.map((edge) => [edge.data.source, edge.data.target]),
      [
        ["n0", "n1"],
        ["n1", "n2"],
      ],
    );
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
    assert.deepStrictEqual(graphElements(status, {}).length, 1);
  });

  test("nodeLabels carries the full state for hover tooltips", () => {
    assert.deepStrictEqual(nodeLabels(status), [
      "fetch (stale)",
      "clean (fresh)",
      "report (stale)",
    ]);
  });

  test("a taskMenu message maps the node back to its id, and the render carries elements, ids, labels and font size", async () => {
    const opened: string[] = [];
    const menus: string[] = [];
    const posted: Record<string, unknown>[] = [];
    const listeners: Array<(message: unknown) => void> = [];
    const view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          listeners.push(listener);
          return { dispose: () => undefined };
        },
        postMessage: (message: Record<string, unknown>) => {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewView;
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      stubMemento(),
      (id) => opened.push(id),
      (id) => menus.push(id),
    );

    provider.resolveWebviewView(view);
    provider.update(status);
    listeners.forEach((listener) => listener({ type: "taskMenu", node: "n1" }));

    assert.deepStrictEqual(menus, ["clean"]);
    assert.deepStrictEqual(opened, []);
    const render = posted.find((message) => message.type === "render");
    assert.deepStrictEqual(render?.ids, ["fetch", "clean", "report"]);
    assert.deepStrictEqual(render?.labels, nodeLabels(status));
    assert.strictEqual(render?.fontSize, 14, "expected the default font size");
    assert.strictEqual(render?.preset, false, "no saved positions yet");
    assert.strictEqual(render?.layout, "top-down", "default layout");
    assert.strictEqual(
      (render?.elements as unknown[]).length,
      5,
      "three nodes plus two edges",
    );

    provider.zoomBy(1.25);
    assert.deepStrictEqual(posted.at(-1), { type: "zoom", factor: 1.25 });

    const config = vscode.workspace.getConfiguration("pdp");
    await config.update("graphFontSize", 20, vscode.ConfigurationTarget.Global);
    try {
      // No manual update(): the config listener must re-render on its own.
      const deadline = Date.now() + 2000;
      let reRendered: number | undefined;
      while (Date.now() < deadline) {
        reRendered = posted
          .filter((message) => message.type === "render")
          .at(-1)?.fontSize as number | undefined;
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
    // Zero tasks is an explained empty state, not a blank canvas.
    provider.update(
      parseStatus(JSON.stringify({ project: "demo", tasks: [] })),
    );
    assert.match(
      String(posted.filter((m) => m.type === "empty").at(-1)?.message),
      /No tasks/,
    );
    provider.dispose();
  });

  test("positions messages persist per project, drop bad ids and values, and switch the layout to preset", async () => {
    const menus: string[] = [];
    const posted: Record<string, unknown>[] = [];
    const listeners: Array<(message: unknown) => void> = [];
    const view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          listeners.push(listener);
          return { dispose: () => undefined };
        },
        postMessage: (message: Record<string, unknown>) => {
          posted.push(message);
          return Promise.resolve(true);
        },
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewView;
    const storage = stubMemento();
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      storage,
      () => undefined,
      (id) => menus.push(id),
    );

    provider.resolveWebviewView(view);
    // Read path: junk persisted in workspaceState must not reach the canvas.
    storage.saved[positionsKey(workspaceRoot() ?? "")] = {
      positions: {
        fetch: { x: "no", y: 1 },
        clean: { x: 1, y: 1 },
        report: { x: 2, y: 2 },
      },
    };
    provider.update(status);
    const seeded = posted.find((message) => message.type === "render") as {
      preset: boolean;
      viewport?: unknown;
      elements: { data: { id: string }; position?: unknown }[];
    };
    assert.strictEqual(seeded.preset, false, "junk position was dropped");
    assert.strictEqual(seeded.viewport, undefined, "no viewport saved");
    assert.strictEqual(
      seeded.elements.find((element) => element.data.id === "n0")?.position,
      undefined,
    );
    assert.deepStrictEqual(
      seeded.elements.find((element) => element.data.id === "n1")?.position,
      { x: 1, y: 1 },
    );

    // A webview is untrusted echo: unknown ids and non-finite values are
    // dropped, and a junk zoom does not become the saved viewport.
    listeners.forEach((listener) =>
      listener({
        type: "positions",
        positions: {
          fetch: { x: 1, y: 2 },
          ghost: { x: 9, y: 9 },
          clean: { x: "no", y: 2 },
          report: { x: Number.NaN, y: 3 },
        },
        zoom: "big",
        pan: { x: -40, y: 10 },
      }),
    );
    const key = positionsKey(workspaceRoot() ?? "");
    assert.ok(key in storage.saved, "positions were not saved");
    assert.deepStrictEqual(storage.saved[key], {
      positions: { fetch: { x: 1, y: 2 } },
    });

    // Complete positions with a viewport: the next render restores both.
    listeners.forEach((listener) =>
      listener({
        type: "positions",
        positions: {
          fetch: { x: 1, y: 1 },
          clean: { x: 2, y: 2 },
          report: { x: 3, y: 3 },
        },
        zoom: 1.5,
        pan: { x: -40, y: 10 },
      }),
    );
    provider.update(status);
    const last = posted
      .filter((message) => message.type === "render")
      .at(-1) as {
      preset: boolean;
      viewport?: unknown;
      elements: { data: { id: string }; position?: unknown }[];
    };
    assert.strictEqual(last.preset, true);
    assert.deepStrictEqual(last.viewport, {
      zoom: 1.5,
      pan: { x: -40, y: 10 },
    });
    const fetchNode = last.elements.find((element) => element.data.id === "n0");
    assert.deepStrictEqual(fetchNode?.position, { x: 1, y: 1 });

    // Manual reset clears the whole layout; runs and refreshes never do.
    await provider.resetLayout();
    assert.deepStrictEqual(storage.saved[key], { positions: {} });
    const afterReset = posted
      .filter((message) => message.type === "render")
      .at(-1) as { preset: boolean; viewport?: unknown };
    assert.strictEqual(afterReset.preset, false);
    assert.strictEqual(afterReset.viewport, undefined);

    // Choosing a layout stores the choice, clears the old geometry (its
    // positions and viewport described the previous layout) and re-renders.
    await provider.chooseLayout("left-right");
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });
    const relaid = posted
      .filter((message) => message.type === "render")
      .at(-1) as { preset: boolean; layout: string };
    assert.strictEqual(relaid.preset, false);
    assert.strictEqual(relaid.layout, "left-right");

    // An unknown layout name is ignored, storage untouched.
    await provider.chooseLayout("circle");
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });

    // Reset goes back to the *chosen* automatic layout, not always top-down.
    listeners.forEach((listener) =>
      listener({
        type: "positions",
        positions: {
          fetch: { x: 1, y: 1 },
          clean: { x: 2, y: 2 },
          report: { x: 3, y: 3 },
        },
        zoom: 1,
        pan: { x: 0, y: 0 },
      }),
    );
    provider.update(status);
    await provider.resetLayout();
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });
    provider.dispose();
  });

  test("graph view renders with cytoscape and keeps the arrangement across refreshes", async () => {
    const ext = vscode.extensions.getExtension("scienceandhumanitylab.pdp");
    assert.ok(ext, "extension not found");
    await ext.activate();
    await vscode.commands.executeCommand("pdp.graph.focus");
    assert.ok(graphView, "graph view not registered");
    graphView.update(status);
    const first = await acked(graphView);
    assert.strictEqual(
      first.preset,
      false,
      "expected a fresh layout — workspaceState may be stale (wipe .vscode-test)",
    );
    // Let the debounced auto-adopt persist the first arrangement.
    await new Promise((resolve) => setTimeout(resolve, 700));
    graphView.update(status); // a watcher-style refresh
    const second = await acked(graphView, first);
    // The refresh must have used the saved (preset) positions — the
    // constructor's implicit grid layout would have moved every node.
    assert.strictEqual(second.preset, true, "refresh was not a preset render");
    assert.deepStrictEqual(
      second.positions,
      first.positions,
      "refresh moved the nodes",
    );
  }).timeout(20000);
});

// Poll the provider's render ack: a new object per render the webview did.
async function acked(
  provider: { lastAck: unknown },
  previous?: unknown,
): Promise<{ preset: boolean; positions: Record<string, unknown> }> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const ack = provider.lastAck;
    if (ack && ack !== previous) {
      return ack as { preset: boolean; positions: Record<string, unknown> };
    }
    if (Date.now() > deadline) {
      assert.fail("the webview did not ack the render in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function stubMemento(): vscode.Memento & { saved: Record<string, unknown> } {
  const saved: Record<string, unknown> = {};
  return {
    saved,
    keys: () => Object.keys(saved),
    get: <T>(key: string) => saved[key] as T,
    update: (key: string, value: unknown) => {
      saved[key] = value;
      return Promise.resolve();
    },
  };
}
