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
    // The valid saved positions still count; only the dropped one is placed.
    assert.strictEqual(seeded.preset, true, "saved positions were discarded");
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

  test("a saved default survives drags, reset restores it, even after choosing a layout", async () => {
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
      () => undefined,
    );
    const key = positionsKey(workspaceRoot() ?? "");
    const send = (message: unknown) =>
      listeners.forEach((listener) => listener(message));

    provider.resolveWebviewView(view);
    provider.update(status);
    provider.saveDefault();
    assert.deepStrictEqual(posted.at(-1), { type: "saveDefault" });

    // The webview answers with its arrangement; still untrusted input.
    send({
      type: "positions",
      asDefault: true,
      positions: {
        fetch: { x: 1, y: 1 },
        clean: { x: 2, y: 2 },
        report: { x: 3, y: 3 },
        ghost: { x: 9, y: 9 },
      },
      zoom: 1.2,
      pan: { x: 5, y: 6 },
    });
    const saved = {
      positions: {
        fetch: { x: 1, y: 1 },
        clean: { x: 2, y: 2 },
        report: { x: 3, y: 3 },
      },
      viewport: { zoom: 1.2, pan: { x: 5, y: 6 } },
    };
    assert.deepStrictEqual(storage.saved[key], { ...saved, saved });

    // A later drag moves the current arrangement, not the default; an
    // asDefault flag the host never asked for is ignored.
    send({
      type: "positions",
      asDefault: true,
      positions: {
        fetch: { x: 7, y: 7 },
        clean: { x: 8, y: 8 },
        report: { x: 9, y: 9 },
      },
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
    assert.deepStrictEqual(
      (storage.saved[key] as { saved?: unknown }).saved,
      saved,
    );

    await provider.resetLayout();
    assert.deepStrictEqual(storage.saved[key], { ...saved, saved });
    const restored = posted
      .filter((message) => message.type === "render")
      .at(-1) as {
      preset: boolean;
      viewport?: unknown;
      elements: { data: { id: string }; position?: unknown }[];
    };
    assert.strictEqual(restored.preset, true);
    assert.deepStrictEqual(restored.viewport, saved.viewport);
    assert.deepStrictEqual(
      restored.elements.find((element) => element.data.id === "n2")?.position,
      { x: 3, y: 3 },
    );

    // Trying an automatic layout keeps the default; Reset comes back to it.
    await provider.chooseLayout("left-right");
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
      saved,
    });
    await provider.resetLayout();
    assert.deepStrictEqual(storage.saved[key], {
      ...saved,
      layout: "left-right",
      saved,
    });

    // Junk in a persisted default never reaches the canvas.
    storage.saved[key] = {
      positions: {},
      saved: { positions: { fetch: { x: "no", y: 1 } }, viewport: "big" },
    };
    await provider.resetLayout();
    assert.deepStrictEqual(storage.saved[key], { positions: {} });

    storage.saved[key] = {
      positions: {},
      saved: { positions: { fetch: { x: "no", y: 1 } }, viewport: "big" },
    };
    await provider.chooseLayout("left-right");
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });
    provider.dispose();
  });

  test("focus messages set pdp.graphFocused and the focused field, dispose clears it", async () => {
    const listeners: Array<(message: unknown) => void> = [];
    const disposes: Array<() => void> = [];
    const view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          listeners.push(listener);
          return { dispose: () => undefined };
        },
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: (listener: () => void) => {
        disposes.push(listener);
        return { dispose: () => undefined };
      },
    } as unknown as vscode.WebviewView;
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      stubMemento(),
      () => undefined,
      () => undefined,
    );
    const originalExecute = vscode.commands.executeCommand;
    const contexts: unknown[][] = [];
    vscode.commands.executeCommand = ((command: string, ...args: unknown[]) => {
      if (command === "setContext") {
        contexts.push(args);
      }
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;

    try {
      provider.resolveWebviewView(view);
      const send = (message: unknown) =>
        listeners.forEach((listener) => listener(message));
      send({ type: "focus", focused: true });
      assert.strictEqual(provider.focused, true);
      assert.deepStrictEqual(contexts.at(-1), ["pdp.graphFocused", true]);
      send({ type: "focus", focused: false });
      assert.strictEqual(provider.focused, false);
      assert.deepStrictEqual(contexts.at(-1), ["pdp.graphFocused", false]);
      // The focused flag is untrusted webview input: junk values read false.
      send({ type: "focus", focused: "yes" });
      assert.strictEqual(provider.focused, false);

      send({ type: "focus", focused: true });
      disposes.forEach((dispose) => dispose());
      assert.strictEqual(provider.focused, false);
      assert.deepStrictEqual(contexts.at(-1), ["pdp.graphFocused", false]);
    } finally {
      vscode.commands.executeCommand = originalExecute;
      provider.dispose();
    }
  });

  test("toolbar buttons carry shortcut hints and aria-keyshortcuts", () => {
    const view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewView & { webview: { html: string } };
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      stubMemento(),
      () => undefined,
      () => undefined,
    );
    provider.resolveWebviewView(view);
    for (const [action, label, key] of [
      ["zoomIn", "Zoom in (I)", "i"],
      ["zoomOut", "Zoom out (O)", "o"],
      ["layout", "Choose layout (L)", "l"],
      ["save", "Save layout as default (S)", "s"],
      ["reset", "Reset layout (R)", "r"],
    ]) {
      assert.ok(
        view.webview.html.includes(
          `data-action="${action}" aria-label="${label}" title="${label}" aria-keyshortcuts="${key}"`,
        ),
        `no ${label} button`,
      );
    }
    assert.ok(
      view.webview.html.includes(
        `id="layoutMenu" role="menu" aria-label="Graph layout" hidden`,
      ),
      "no layout menu container",
    );
    assert.ok(
      view.webview.html.includes("menuitemradio"),
      "no menu item role in the webview script",
    );
    assert.ok(
      view.webview.html.includes("var(--vscode-menu-background)") &&
        view.webview.html.includes("var(--vscode-menu-selectionBackground)"),
      "layout menu CSS is not on theme colours",
    );
    assert.ok(
      view.webview.html.includes(
        `event.key === "ArrowDown" || event.key === "j"`,
      ) &&
        view.webview.html.includes(
          `event.key === "ArrowUp" || event.key === "k"`,
        ),
      "no j/k mapping in the layout menu key handler",
    );
    assert.ok(
      view.webview.html.includes(
        "#toolbar button:focus { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }",
      ),
      "focused toolbar button is not unmistakable",
    );
    assert.ok(
      view.webview.html.includes(`event.key !== "Tab"`) &&
        view.webview.html.includes("buttons[next].focus();"),
      "no Tab wrap handler on the toolbar",
    );
    assert.ok(
      view.webview.html.includes(
        'if (event.key !== "Tab" || event.defaultPrevented) return;',
      ) &&
        view.webview.html.includes(
          "toolbar.contains(document.activeElement)",
        ) &&
        view.webview.html.includes(
          "(event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();",
        ),
      "no document-level Tab routing into the toolbar",
    );
    provider.dispose();
  });

  test("chooseLayout messages store the layout, junk changes nothing, and the render lists the layouts", async () => {
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
      () => undefined,
    );
    provider.resolveWebviewView(view);
    provider.update(status);
    const send = (message: unknown) =>
      listeners.forEach((listener) => listener(message));
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const render = posted.find((message) => message.type === "render");
    assert.deepStrictEqual(
      (render?.layouts as { name: string }[]).map((layout) => layout.name),
      ["top-down", "left-right", "force"],
    );

    const key = positionsKey(workspaceRoot() ?? "");
    send({ type: "chooseLayout", name: "left-right" });
    await tick();
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });

    // The name is untrusted: unknown, non-string and missing change nothing.
    send({ type: "chooseLayout", name: "constructor" });
    send({ type: "chooseLayout", name: 42 });
    send({ type: "chooseLayout" });
    await tick();
    assert.deepStrictEqual(storage.saved[key], {
      positions: {},
      layout: "left-right",
    });
    provider.dispose();
  });

  test("openLayoutMenu posts layoutMenu only when focused; the toolbar layout action stays in the webview", async () => {
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
      () => undefined,
      () => undefined,
    );
    provider.resolveWebviewView(view);
    const send = (message: unknown) =>
      listeners.forEach((listener) => listener(message));

    assert.strictEqual(provider.openLayoutMenu(), false);
    assert.strictEqual(posted.length, 0, "posted while not focused");
    send({ type: "focus", focused: true });
    assert.strictEqual(provider.openLayoutMenu(), true);
    assert.deepStrictEqual(posted, [{ type: "layoutMenu" }]);

    // The layout button is webview-owned now: the toolbar action must not
    // reach pdp.graphChooseLayout.
    const originalExecute = vscode.commands.executeCommand;
    const commands: string[] = [];
    vscode.commands.executeCommand = ((command: string) => {
      commands.push(command);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;
    try {
      send({ type: "toolbar", action: "layout" });
      send({ type: "focus", focused: false });
      assert.strictEqual(provider.openLayoutMenu(), false);
      assert.strictEqual(posted.length, 1, "posted while not focused");
      assert.ok(
        !commands.includes("pdp.graphChooseLayout"),
        "toolbar layout action still runs the QuickPick command",
      );
    } finally {
      vscode.commands.executeCommand = originalExecute;
      provider.dispose();
    }
  });

  test("save and reset confirm on the status bar", async () => {
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
      () => undefined,
      () => undefined,
    );
    provider.resolveWebviewView(view);
    provider.update(status);
    const send = (message: unknown) =>
      listeners.forEach((listener) => listener(message));
    const originalBar = vscode.window.setStatusBarMessage;
    const bar: [string, number | undefined][] = [];
    vscode.window.setStatusBarMessage = ((
      message: string,
      timeout?: unknown,
    ) => {
      bar.push([message, timeout as number | undefined]);
      return { dispose: () => undefined };
    }) as typeof vscode.window.setStatusBarMessage;

    try {
      // Nothing saved and no layout chosen: reset announces top-down.
      await provider.resetLayout();
      assert.deepStrictEqual(bar.at(-1), [
        "PDP: Layout reset to Top-down",
        4000,
      ]);

      // A chosen layout is what reset returns to without a saved default.
      await provider.chooseLayout("left-right");
      await provider.resetLayout();
      assert.deepStrictEqual(bar.at(-1), [
        "PDP: Layout reset to Left-right",
        4000,
      ]);

      // Saving a default confirms, and later resets name it.
      provider.saveDefault();
      send({
        type: "positions",
        asDefault: true,
        positions: {
          fetch: { x: 1, y: 1 },
          clean: { x: 2, y: 2 },
          report: { x: 3, y: 3 },
        },
        zoom: 1,
        pan: { x: 0, y: 0 },
      });
      assert.deepStrictEqual(bar.at(-1), [
        "PDP: Layout saved as default",
        4000,
      ]);
      await provider.resetLayout();
      assert.deepStrictEqual(bar.at(-1), [
        "PDP: Layout reset to saved default",
        4000,
      ]);
    } finally {
      vscode.window.setStatusBarMessage = originalBar;
      provider.dispose();
    }
  });

  test("the in-graph toolbar replaces the title-bar buttons, which collapsed the view", async () => {
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
    } as unknown as vscode.WebviewView & { webview: { html: string } };
    const provider = new PdpGraphViewProvider(
      vscode.Uri.file("/ext"),
      stubMemento(),
      () => undefined,
      () => undefined,
    );
    provider.resolveWebviewView(view);
    for (const [action, label] of [
      ["zoomIn", "Zoom in (I)"],
      ["zoomOut", "Zoom out (O)"],
      ["layout", "Choose layout (L)"],
      ["save", "Save layout as default (S)"],
      ["reset", "Reset layout (R)"],
    ]) {
      assert.ok(
        view.webview.html.includes(
          `data-action="${action}" aria-label="${label}"`,
        ),
        `no ${label} button`,
      );
    }

    const send = (message: unknown) =>
      listeners.forEach((listener) => listener(message));
    send({ type: "toolbar", action: "zoomIn" });
    assert.deepStrictEqual(posted.at(-1), { type: "zoom", factor: 1.25 });
    send({ type: "toolbar", action: "zoomOut" });
    assert.deepStrictEqual(posted.at(-1), { type: "zoom", factor: 1 / 1.25 });
    // Reset re-renders: with no status yet that is the "no project" message.
    send({ type: "toolbar", action: "reset" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(posted.at(-1)?.type, "empty");
    send(null);
    // The action name is untrusted: inherited keys and unknown names do nothing.
    const count = posted.length;
    send({ type: "toolbar", action: "constructor" });
    send({ type: "toolbar", action: "rm -rf" });
    assert.strictEqual(posted.length, count);

    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
    const titleMenu = ext?.packageJSON.contributes.menus["view/title"] as {
      when: string;
    }[];
    assert.ok(
      titleMenu.every((item) => !item.when.includes("pdp.graph")),
      "graph actions are back on the title bar",
    );
    provider.dispose();
  });

  test("graph view renders with cytoscape and keeps the arrangement across refreshes", async () => {
    const ext = vscode.extensions.getExtension(
      "scienceandhumanitylab.pdp-vscode",
    );
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

  test("the automatic layout spreads a diamond-shaped graph without stacking boxes", async () => {
    assert.ok(graphView, "graph view not registered");
    const before = graphView.lastAck;
    await graphView.chooseLayout("top-down");
    const cleared = await acked(graphView, before);
    graphView.update(
      statusOf([
        ["d-import", []],
        ["d-clean", ["d-import"]],
        ["d-filter", ["d-clean"]],
        ["d-explore", ["d-clean"]],
        ["d-model", ["d-filter"]],
        ["d-report", ["d-filter", "d-explore", "d-model"]],
      ]),
    );
    const ack = await acked(graphView, cleared);
    assert.strictEqual(ack.preset, false);
    const spots = new Set(
      Object.values(ack.positions).map((p) => JSON.stringify(p)),
    );
    assert.strictEqual(spots.size, 6, "boxes share a position");
  }).timeout(20000);

  test("top-down packs siblings and tiers close, and a new task joins without moving the rest", async () => {
    assert.ok(graphView, "graph view not registered");
    // Start from nothing saved, whatever earlier tests left behind.
    const before = graphView.lastAck;
    await graphView.chooseLayout("top-down");
    const cleared = await acked(graphView, before);
    const fan = statusOf([
      ["hub", []],
      ["leaf1", ["hub"]],
      ["leaf2", ["hub"]],
      ["leaf3", ["hub"]],
    ]);
    graphView.update(fan);
    const first = await acked(graphView, cleared);
    assert.strictEqual(first.preset, false, "expected a fresh layout");
    const at = (ack: typeof first, id: string) =>
      ack.positions[id] as { x: number; y: number };
    const leaves = ["n1", "n2", "n3"].map((id) => at(first, id));
    assert.ok(
      leaves.every((leaf) => leaf.y === leaves[0].y),
      "siblings share a tier",
    );
    const xs = leaves.map((leaf) => leaf.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      assert.ok(gap > 40 && gap < 100, `sibling spacing ${gap}`);
    }
    const tier = leaves[0].y - at(first, "n0").y;
    assert.ok(tier > 30 && tier < 100, `tier spacing ${tier}`);

    // Let the debounced auto-adopt persist the arrangement.
    await new Promise((resolve) => setTimeout(resolve, 700));
    graphView.update(
      statusOf([
        ["hub", []],
        ["leaf1", ["hub"]],
        ["leaf2", ["hub"]],
        ["leaf3", ["hub"]],
        ["tail", ["leaf1"]],
      ]),
    );
    const grown = await acked(graphView, first);
    assert.strictEqual(grown.preset, true, "the saved positions were dropped");
    for (const id of ["n0", "n1", "n2", "n3"]) {
      assert.deepStrictEqual(at(grown, id), at(first, id), `${id} moved`);
    }
    assert.strictEqual(at(grown, "n4").x, at(first, "n1").x);
    assert.ok(at(grown, "n4").y > at(first, "n1").y, "tail sits below leaf1");

    // The placement was persisted: the next refresh keeps it.
    graphView.update(
      statusOf([
        ["hub", []],
        ["leaf1", ["hub"]],
        ["leaf2", ["hub"]],
        ["leaf3", ["hub"]],
        ["tail", ["leaf1"]],
      ]),
    );
    const again = await acked(graphView, grown);
    assert.deepStrictEqual(again.positions, grown.positions);
  }).timeout(20000);
});

function statusOf(tasks: [string, string[]][]) {
  return parseStatus(
    JSON.stringify({
      project: "demo",
      tasks: tasks.map(([id, depends_on]) => ({
        id,
        stale: false,
        depends_on,
        description: "",
        entrypoint: "make",
        slurm: {},
      })),
    }),
  );
}

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
