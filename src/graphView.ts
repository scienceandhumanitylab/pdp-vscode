import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { workspaceRoot, type ProjectStatus, type TaskStatus } from "./pdp";

export interface GraphPosition {
  x: number;
  y: number;
}

// Task id -> last dragged position; one map per project root (ADR 0003).
export type TaskPositions = Record<string, GraphPosition>;

// The saved viewport keeps the user's zoom/pan across re-renders (running a
// task refreshes the graph and must not move their view).
export interface GraphViewport {
  zoom: number;
  pan: { x: number; y: number };
}

// Everything remembered about a project's graph arrangement.
export interface GraphLayout {
  positions: TaskPositions;
  layout?: LayoutName;
  viewport?: GraphViewport;
}

// The automatic layouts offered in the Graph view; the stored name is
// untrusted input and must be one of these.
export const GRAPH_LAYOUTS: {
  label: string;
  description: string;
  name: LayoutName;
}[] = [
  {
    label: "Top-down",
    description: "tiered, top to bottom (default)",
    name: "top-down",
  },
  {
    label: "Left-right",
    description: "tiered, left to right",
    name: "left-right",
  },
  {
    label: "Force-directed",
    description: "organic; ignores edge direction",
    name: "force",
  },
];

export type LayoutName = "top-down" | "left-right" | "force";

function validLayoutName(input: unknown): LayoutName | undefined {
  return GRAPH_LAYOUTS.some((layout) => layout.name === input)
    ? (input as LayoutName)
    : undefined;
}

export interface GraphElement {
  group: "nodes" | "edges";
  data: { id: string; label?: string; source?: string; target?: string };
  classes?: string;
  position?: GraphPosition;
}

// Pure builder for the Cytoscape elements json. Nodes get generated ids
// (n0, n1, ...) so hostile task ids cannot forge element ids; labels carry
// the ✗/✓ text marker next to the stale/fresh colour (ADR 0005) — the
// webview measures each label and sizes the box around it with PAD_X/PAD_Y.
// Edges run from upstream to downstream; unknown depends_on ids are skipped.
export function graphElements(
  status: ProjectStatus,
  positions: TaskPositions,
): GraphElement[] {
  const index = new Map(status.tasks.map((task, i) => [task.id, i]));
  const nodes: GraphElement[] = status.tasks.map((task, i) => {
    const node: GraphElement = {
      group: "nodes",
      data: {
        id: `n${i}`,
        label: `${task.id} ${task.stale ? "✗" : "✓"}`,
      },
      classes: task.stale ? "stale" : "fresh",
    };
    if (positions[task.id]) {
      node.position = positions[task.id];
    }
    return node;
  });
  const edges: GraphElement[] = [];
  status.tasks.forEach((task, i) => {
    for (const dep of task.depends_on) {
      const upstream = index.get(dep);
      if (upstream !== undefined) {
        edges.push({
          group: "edges",
          data: {
            id: `e${edges.length}`,
            source: `n${upstream}`,
            target: `n${i}`,
          },
        });
      }
    }
  });
  return [...nodes, ...edges];
}

// Hover text per node, in node order (n0, n1, ...): the node label is the
// compact "id ✗/✓", so the state in words moves to the hover div.
export function nodeLabels(status: ProjectStatus): string[] {
  return status.tasks.map(
    (task) => `${task.id} (${task.stale ? "stale" : "fresh"})`,
  );
}

// Positions persist per project root; task ids key into that map.
export function positionsKey(root: string): string {
  return `pdp.graph.positions:${root}`;
}

// workspaceState and webview echoes are persisted/untrusted input: keep only
// finite coordinates, drop the rest silently.
function validPositions(input: unknown): TaskPositions {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  const positions: TaskPositions = {};
  for (const [id, pos] of Object.entries(input)) {
    const { x, y } = (pos ?? {}) as { x?: unknown; y?: unknown };
    if (
      typeof x === "number" &&
      Number.isFinite(x) &&
      typeof y === "number" &&
      Number.isFinite(y)
    ) {
      positions[id] = { x, y };
    }
  }
  return positions;
}

// Webview echoes and persisted state stay untrusted: a viewport counts only
// with a positive finite zoom and finite pan.
function validViewport(zoom: unknown, pan: unknown): GraphViewport | undefined {
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0) {
    return undefined;
  }
  if (typeof pan !== "object" || pan === null) {
    return undefined;
  }
  const { x, y } = pan as { x?: unknown; y?: unknown };
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    return undefined;
  }
  return { zoom, pan: { x, y } };
}

function validLayout(input: unknown): GraphLayout {
  if (typeof input !== "object" || input === null) {
    return { positions: {} };
  }
  const { positions, viewport, layout } = input as {
    positions?: unknown;
    layout?: unknown;
    viewport?: { zoom?: unknown; pan?: unknown };
  };
  const name = validLayoutName(layout);
  const valid: GraphLayout = { positions: validPositions(positions) };
  if (name) {
    valid.layout = name;
  }
  const parsedViewport = viewport
    ? validViewport(viewport.zoom, viewport.pan)
    : undefined;
  if (parsedViewport) {
    valid.viewport = parsedViewport;
  }
  return valid;
}

// Invalid or missing settings fall back to the schema default rather than
// producing unreadable or negative-size text.
function graphFontSize(): number {
  const size = vscode.workspace
    .getConfiguration("pdp")
    .get<number>("graphFontSize");
  return typeof size === "number" && size > 0 ? size : 14;
}

function html(webview: vscode.Webview, nonce: string, scriptUri: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<style>
  body { margin: 0; }
  #graph { position: relative; width: 100%; height: 100vh; }
  #tip { position: absolute; display: none; padding: 2px 6px; border-radius: 3px;
    font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 10;
    background: var(--vscode-editorHoverWidget-background, #2d2d30);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545); }
</style>
</head>
<body>
<div id="graph" role="img" aria-label="PDP task graph"></div>
<script src="${scriptUri}"></script>
<script type="module" nonce="${nonce}">
  const cytoscape = globalThis.cytoscape;
  const container = document.getElementById("graph");
  const vscode = acquireVsCodeApi();
  const tip = document.createElement("div");
  tip.id = "tip";
  document.body.appendChild(tip);
  let cy = null;
  let ids = [];
  let labels = [];
  let saveTimer = null;
  // Viewport events fire while a render applies the saved layout; only the
  // user's own zooming/panning is persisted.
  let restoring = false;
  let lastPreset = false;

  // Box padding around the node text; tweak these to change the fit.
  const FONT = "Segoe UI, system-ui, sans-serif";
  const PAD_X = 10;
  const PAD_Y = 6;
  const measure = document.createElement("canvas").getContext("2d");

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data.type === "empty") {
      clearTimeout(saveTimer);
      if (cy) { cy.destroy(); cy = null; }
      container.textContent = data.message;
      return;
    }
    if (data.type !== "render" && data.type !== "zoom") {
      return;
    }
    if (data.type === "zoom") {
      // The title-bar buttons; zooming about the view's centre. The zoom
      // handler below persists the result like a wheel zoom.
      if (
        cy &&
        typeof data.factor === "number" &&
        Number.isFinite(data.factor) &&
        data.factor > 0
      ) {
        cy.zoom({
          level: cy.zoom() * data.factor,
          renderedPosition: {
            x: container.clientWidth / 2,
            y: container.clientHeight / 2,
          },
        });
      }
      return;
    }
    ids = data.ids ?? [];
    labels = data.labels ?? [];
    render(data.elements, data.preset, data.viewport, data.layout, data.dark, data.fontSize);
  });

  window.addEventListener("resize", () => { if (cy) { cy.resize(); } });

  function nodeIndex(node) {
    const i = Number(node.id().slice(1));
    return Number.isInteger(i) ? i : undefined;
  }

  // The whole arrangement — positions and viewport — goes to the host on
  // drag end, and debounced after the user zooms or pans.
  function postLayout() {
    const positions = {};
    cy.nodes().forEach((node) => {
      const id = ids[nodeIndex(node)];
      if (id !== undefined) {
        positions[id] = node.position();
      }
    });
    vscode.postMessage({
      type: "positions",
      positions: positions,
      zoom: cy.zoom(),
      pan: cy.pan(),
    });
  }

  // The rendered ack doubles as a regression hook: the host-side test
  // compares the acked node positions across refreshes.
  function ack() {
    const positions = {};
    if (cy) {
      cy.nodes().forEach((node) => {
        positions[node.id()] = node.position();
      });
    }
    vscode.postMessage({
      type: "rendered",
      positions: positions,
      preset: lastPreset,
    });
  }

  // The automatic layouts; breadthfirst is top-to-bottom, so left-right
  // swaps the coordinates it produces.
  function layoutOptions(name, elements) {
    if (name === "force") {
      // randomize: positions are cleared first, and cose from one shared
      // point unfolds a clump instead of spreading.
      return { name: "cose", padding: 30, animate: false, randomize: true };
    }
    const incoming = new Set(
      elements.filter((e) => e.group === "edges").map((e) => e.data.target),
    );
    const options = {
      name: "breadthfirst",
      directed: true,
      padding: 30,
      spacingFactor: 1.15,
      roots: elements
        .filter((e) => e.group === "nodes" && !incoming.has(e.data.id))
        .map((e) => e.data.id),
    };
    if (name === "left-right") {
      options.transform = (node, pos) => ({ x: pos.y, y: pos.x });
    }
    return options;
  }

  // Plain nodes have no padding, and cytoscape's width/height "label" is
  // deprecated and hugs the text; measure each label and size the box
  // around it instead.
  function render(elements, preset, viewport, layoutName, dark, fontSize) {
    clearTimeout(saveTimer);
    if (cy) { cy.destroy(); }
    tip.style.display = "none";
    container.textContent = "";
    const size = fontSize ?? 14;
    const line = dark ? "#9aa0a6" : "#6e7681";
    measure.font = size + "px " + FONT;
    elements.forEach((e) => {
      if (e.group === "nodes") {
        e.data.w = measure.measureText(e.data.label).width + 2 * PAD_X;
      }
    });
    cy = cytoscape({
      container: container,
      elements: elements,
      // The constructor silently runs a *grid* layout when none is given,
      // which overwrote the saved preset positions on every refresh;
      // "preset" just places nodes where their json says.
      layout: { name: "preset", fit: false },
      // fit() zooms small graphs past 100% and drowns out the font-size
      // setting; cap zoom so a node's text renders near its set size.
      maxZoom: 1.5,
      style: [
        { selector: "node", style: {
          shape: "round-rectangle",
          width: "data(w)",
          height: size * 1.2 + 2 * PAD_Y,
          label: "data(label)",
          color: "#000000",
          "font-size": size,
          "font-family": FONT,
          "text-valign": "center",
          "text-halign": "center",
          "border-width": 1,
          "border-color": "#3c3836",
        } },
        { selector: "node.stale", style: { "background-color": "#f48f84" } },
        { selector: "node.fresh", style: { "background-color": "#83a598" } },
        { selector: "edge", style: {
          width: 1.5,
          "line-color": line,
          "target-arrow-color": line,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        } },
      ],
    });
    cy.on("tap", "node", (event) => {
      vscode.postMessage({ type: "openTask", node: event.target.id() });
    });
    cy.on("cxttap", "node", (event) => {
      vscode.postMessage({ type: "taskMenu", node: event.target.id() });
    });
    // Dragging moves pixels only: on drag end the whole arrangement is sent
    // to the host, which persists it; nodes and edges always come from pdp.
    // shortcut: a zoom/pan ≤400 ms before a re-render or layout choice is
    // overwritten once and self-corrects; correlate renders if that ever
    // matters.
    cy.on("dragfree", "node", () => {
      clearTimeout(saveTimer);
      postLayout();
    });
    cy.on("zoom pan", () => {
      if (restoring) { return; }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(postLayout, 400);
    });
    cy.on("mouseover", "node", (event) => {
      const label = labels[nodeIndex(event.target)];
      if (label === undefined) {
        return;
      }
      const p = event.target.renderedPosition();
      tip.textContent = label;
      tip.style.left = Math.round(p.x + 12) + "px";
      tip.style.top = Math.round(p.y + 14) + "px";
      tip.style.display = "block";
    });
    cy.on("mouseout", "node", () => {
      tip.style.display = "none";
    });
    if (preset) {
      cy.resize();
      // destroy() resets pan/zoom; restore the saved viewport so refreshes
      // keep the user's view, fitting only when none is saved yet.
      restoring = true;
      if (viewport && Number.isFinite(viewport.zoom) && viewport.pan) {
        cy.zoom(viewport.zoom);
        cy.pan(viewport.pan);
      } else {
        cy.fit(undefined, 30);
      }
      restoring = false;
      lastPreset = true;
      ack();
      return;
    }
    lastPreset = false;
    const layout = cy.layout(
      layoutOptions(layoutName ?? "top-down", elements),
    );
    layout.one("layoutstop", () => {
      cy.fit(undefined, 30);
      ack();
    });
    layout.run();
  }

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}

// A sidebar WebviewView: VS Code disposes it when hidden and calls
// resolveWebviewView again on re-show, so status is stored and pushed on "ready".
export class PdpGraphViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private status: ProjectStatus | null = null;
  private readonly onOpenTask: (id: string) => void;
  private readonly onTaskMenu: (id: string) => void;
  private readonly themeListener: vscode.Disposable;
  private readonly configListener: vscode.Disposable;
  private renderedResolve!: (rendered: boolean) => void;
  private lastRenderAck: {
    preset: boolean;
    positions: TaskPositions;
  } | null = null;
  /** Resolves true once the webview has rendered a graph (test hook). */
  readonly rendered: Promise<boolean>;

  /** What the webview acked for its latest render (test hook). */
  get lastAck(): { preset: boolean; positions: TaskPositions } | null {
    return this.lastRenderAck;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storage: vscode.Memento,
    onOpenTask: (id: string) => void,
    onTaskMenu: (id: string) => void,
  ) {
    this.onOpenTask = onOpenTask;
    this.onTaskMenu = onTaskMenu;
    this.rendered = new Promise<boolean>((resolve) => {
      this.renderedResolve = resolve;
    });
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() =>
      this.push(),
    );
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("pdp.graphFontSize")) {
        this.push();
      }
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    const nonce = randomBytes(24).toString("hex");
    view.webview.html = html(
      view.webview,
      nonce,
      view.webview
        .asWebviewUri(
          vscode.Uri.joinPath(this.extensionUri, "media", "cytoscape.min.js"),
        )
        .toString(),
    );
    view.webview.onDidReceiveMessage((message) => {
      if (message.type === "ready") {
        this.pushStatus();
      }
      if (message.type === "rendered") {
        this.renderedResolve(true);
        this.lastRenderAck = {
          preset: message.preset === true,
          positions: validPositions(message.positions),
        };
      }
      if (message.type === "positions") {
        this.saveLayout(message.positions, message.zoom, message.pan);
      }
      if (message.type === "openTask" || message.type === "taskMenu") {
        const task = this.taskAt(message.node);
        if (task) {
          if (message.type === "openTask") {
            this.onOpenTask(task.id);
          } else {
            this.onTaskMenu(task.id);
          }
        }
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = null;
      }
    });
  }

  update(status: ProjectStatus | null): void {
    this.status = status;
    if (this.view) {
      this.pushStatus();
    }
  }

  // Zero tasks (a fresh `pdp init`) is an empty canvas, not a broken one.
  private pushStatus(): void {
    if (this.status && this.status.tasks.length > 0) {
      this.push();
    } else {
      this.pushEmpty(
        this.status
          ? "No tasks in this project yet. Create one with PDP: Create Task."
          : "No pdp project in this workspace. Open a workspace with a pdp.yml, then refresh.",
      );
    }
  }

  private taskAt(node: unknown): TaskStatus | undefined {
    if (typeof node !== "string" || !/^n\d+$/.test(node)) {
      return undefined;
    }
    return this.status?.tasks[Number(node.slice(1))];
  }

  // The webview echoes ids we sent, but it stays untrusted input: accept
  // only ids in the current status, finite coordinates and a sane viewport.
  private saveLayout(positions: unknown, zoom: unknown, pan: unknown): void {
    const root = workspaceRoot();
    if (!root || !this.status) {
      return;
    }
    const known = new Set(this.status.tasks.map((task) => task.id));
    const valid = validPositions(positions);
    const accepted: TaskPositions = {};
    for (const [id, position] of Object.entries(valid)) {
      if (known.has(id)) {
        accepted[id] = position;
      }
    }
    const viewport = validViewport(zoom, pan);
    if (Object.keys(accepted).length > 0) {
      const layout: GraphLayout = { positions: accepted };
      // Arrangement saves must not clobber the chosen layout name.
      const current = validLayout(
        this.storage.get<GraphLayout>(positionsKey(root)),
      );
      if (current.layout) {
        layout.layout = current.layout;
      }
      if (viewport) {
        layout.viewport = viewport;
      }
      void this.storage.update(positionsKey(root), layout);
    }
  }

  // The user's only way back to the automatic layout: clear everything
  // remembered about their arrangement (keeping the chosen layout name)
  // and re-render. Runs and refreshes never touch it.
  async resetLayout(): Promise<void> {
    const root = workspaceRoot();
    if (root) {
      const current = validLayout(
        this.storage.get<GraphLayout>(positionsKey(root)),
      );
      const cleared: GraphLayout = { positions: {} };
      if (current.layout) {
        cleared.layout = current.layout;
      }
      await this.storage.update(positionsKey(root), cleared);
    }
    this.pushStatus();
  }

  // Title-bar zoom buttons; the webview centres the zoom and the existing
  // save path persists the result.
  zoomBy(factor: number): void {
    void this.view?.webview.postMessage({ type: "zoom", factor });
  }

  // Switching the automatic layout means new geometry: the old positions
  // and viewport described the previous layout, so both are cleared.
  async chooseLayout(name: string): Promise<void> {
    const root = workspaceRoot();
    const layoutName = validLayoutName(name);
    if (!root || !layoutName) {
      return;
    }
    await this.storage.update(positionsKey(root), {
      positions: {},
      layout: layoutName,
    });
    this.pushStatus();
  }

  private pushEmpty(message: string): void {
    void this.view?.webview.postMessage({
      type: "empty",
      message,
    });
  }

  private push(): void {
    if (!this.status || !this.view) {
      return;
    }
    const root = workspaceRoot();
    const layout = validLayout(
      root ? this.storage.get<GraphLayout>(positionsKey(root)) : undefined,
    );
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind ===
        vscode.ColorThemeKind.HighContrast;
    void this.view.webview.postMessage({
      type: "render",
      elements: graphElements(this.status, layout.positions),
      ids: this.status.tasks.map((task) => task.id),
      labels: nodeLabels(this.status),
      // preset restores saved positions and the saved viewport; the stored
      // layout name runs otherwise (first render, added task, reset).
      preset:
        this.status.tasks.length > 0 &&
        this.status.tasks.every(
          (task) => layout.positions[task.id] !== undefined,
        ),
      viewport: layout.viewport,
      layout: layout.layout ?? "top-down",
      dark,
      fontSize: graphFontSize(),
    });
  }

  dispose(): void {
    this.themeListener.dispose();
    this.configListener.dispose();
  }
}
