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

// An arrangement the user saved as the one Reset returns to.
export interface SavedArrangement {
  positions: TaskPositions;
  viewport?: GraphViewport;
}

// Everything remembered about a project's graph arrangement.
export interface GraphLayout {
  positions: TaskPositions;
  layout?: LayoutName;
  viewport?: GraphViewport;
  saved?: SavedArrangement;
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
    description: "organic",
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
// the ✗/✓/⟳ text marker next to the stale/fresh/running colour (ADR 0005) — the
// webview measures each label and sizes the box around it with PAD_X/PAD_Y.
// Edges run from upstream to downstream; unknown depends_on ids are skipped.
export function graphElements(
  status: ProjectStatus,
  positions: TaskPositions,
  running: ReadonlySet<string> = new Set(),
): GraphElement[] {
  const index = new Map(status.tasks.map((task, i) => [task.id, i]));
  const nodes: GraphElement[] = status.tasks.map((task, i) => {
    const node: GraphElement = {
      group: "nodes",
      data: {
        id: `n${i}`,
        label: `${task.id} ${running.has(task.id) ? "⟳" : task.stale ? "✗" : "✓"}`,
      },
      classes: running.has(task.id)
        ? "running"
        : task.stale
          ? "stale"
          : "fresh",
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
// compact "id ✗/✓/⟳", so the state in words moves to the hover div.
export function nodeLabels(
  status: ProjectStatus,
  running: ReadonlySet<string> = new Set(),
): string[] {
  return status.tasks.map(
    (task) =>
      `${task.id} (${running.has(task.id) ? "running" : task.stale ? "stale" : "fresh"})`,
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
  const { positions, viewport, layout, saved } = input as {
    positions?: unknown;
    layout?: unknown;
    viewport?: { zoom?: unknown; pan?: unknown };
    saved?: unknown;
  };
  const name = validLayoutName(layout);
  const valid: GraphLayout = validArrangement({ positions, viewport });
  if (name) {
    valid.layout = name;
  }
  const savedArrangement = validArrangement(saved);
  if (Object.keys(savedArrangement.positions).length > 0) {
    valid.saved = savedArrangement;
  }
  return valid;
}

function validArrangement(input: unknown): SavedArrangement {
  if (typeof input !== "object" || input === null) {
    return { positions: {} };
  }
  const { positions, viewport } = input as {
    positions?: unknown;
    viewport?: { zoom?: unknown; pan?: unknown };
  };
  const valid: SavedArrangement = { positions: validPositions(positions) };
  const parsedViewport =
    typeof viewport === "object" && viewport !== null
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
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; }
  #graph { position: relative; width: 100%; flex: 1; min-height: 0; }
  #tip { position: absolute; display: none; padding: 2px 6px; border-radius: 3px;
    font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 10;
    background: var(--vscode-editorHoverWidget-background, #2d2d30);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545); }
  #toolbar { display: flex; justify-content: flex-end; gap: 2px; padding: 4px; }
  #toolbar[hidden] { display: none; }
  #toolbar button { min-width: 24px; height: 22px; padding: 0 6px; border-radius: 2px;
    font: 12px var(--vscode-font-family, sans-serif); cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-contrastBorder, transparent); }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #toolbar button:focus { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
  #layoutMenu { position: absolute; z-index: 20; padding: 2px 0; white-space: nowrap;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
    border: 1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, transparent)); }
  #layoutMenu[hidden] { display: none; }
  #layoutMenu [role="menuitemradio"] { padding: 3px 10px; cursor: pointer;
    font: 12px var(--vscode-font-family, sans-serif); }
  #layoutMenu [role="menuitemradio"]:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4);
    background: var(--vscode-menu-selectionBackground);
    color: var(--vscode-menu-selectionForeground); }
</style>
</head>
<body>
<div id="toolbar" role="group" aria-label="Graph actions" hidden>
  <button type="button" data-action="zoomIn" aria-label="Zoom in (I)" title="Zoom in (I)" aria-keyshortcuts="i">+</button>
  <button type="button" data-action="zoomOut" aria-label="Zoom out (O)" title="Zoom out (O)" aria-keyshortcuts="o">−</button>
  <button type="button" data-action="layout" aria-label="Choose layout (L)" title="Choose layout (L)" aria-keyshortcuts="l">Layout</button>
  <button type="button" data-action="save" aria-label="Save layout as default (S)" title="Save layout as default (S)" aria-keyshortcuts="s">Save</button>
  <button type="button" data-action="reset" aria-label="Reset layout (R)" title="Reset layout (R)" aria-keyshortcuts="r">Reset</button>
</div>
<div id="graph" role="img" aria-label="pdp task graph"></div>
<div id="layoutMenu" role="menu" aria-label="Graph layout" hidden></div>
<script src="${scriptUri}"></script>
<script type="module" nonce="${nonce}">
  const cytoscape = globalThis.cytoscape;
  const container = document.getElementById("graph");
  const vscode = acquireVsCodeApi();
  const tip = document.createElement("div");
  tip.id = "tip";
  document.body.appendChild(tip);
  const toolbar = document.getElementById("toolbar");
  const layoutMenu = document.getElementById("layoutMenu");
  const layoutButton = toolbar.querySelector('button[data-action="layout"]');
  let layouts = [];
  let currentLayout = "top-down";
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) {
      if (button.dataset.action === "layout") {
        // keyboard "clicks" carry 0,0; fall back to the button's position
        openLayoutMenu(event.detail === 0 ? undefined : event.clientX, event.clientY);
        return;
      }
      vscode.postMessage({ type: "toolbar", action: button.dataset.action });
    }
  });

  // The menu is HTML because the VS Code API cannot position a QuickPick.
  // shortcut: the layout list is host-provided and re-built on every open;
  // rebuild on focus too if a re-render mid-open ever matters.
  function buildLayoutItems() {
    layoutMenu.textContent = "";
    layouts.forEach((entry) => {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitemradio");
      item.tabIndex = -1;
      const checked = entry.name === currentLayout;
      item.setAttribute("aria-checked", checked ? "true" : "false");
      item.textContent =
        (checked ? "✓ " : "   ") + entry.label + " — " + entry.description;
      item.dataset.name = entry.name;
      item.addEventListener("click", () => postChooseLayout(entry.name));
      layoutMenu.appendChild(item);
    });
  }

  function openLayoutMenu(x, y) {
    if (layouts.length === 0) {
      return;
    }
    buildLayoutItems();
    layoutMenu.hidden = false;
    if (x === undefined) {
      const rect = layoutButton.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    }
    layoutMenu.style.left =
      Math.max(0, Math.min(x, window.innerWidth - layoutMenu.offsetWidth)) +
      "px";
    layoutMenu.style.top =
      Math.max(
        0,
        Math.min(y, window.innerHeight - layoutMenu.offsetHeight),
      ) + "px";
    tip.style.display = "none";
    (layoutMenu.querySelector('[aria-checked="true"]') ?? layoutMenu.firstChild)
      .focus();
  }

  function closeLayoutMenu() {
    if (layoutMenu.hidden) {
      return;
    }
    layoutMenu.hidden = true;
    layoutButton.focus();
  }

  function postChooseLayout(name) {
    vscode.postMessage({ type: "chooseLayout", name: name });
    closeLayoutMenu();
  }

  layoutMenu.addEventListener("keydown", (event) => {
    const items = Array.from(layoutMenu.children);
    const i = items.indexOf(document.activeElement);
    const move = (next) => {
      event.preventDefault();
      items[next].focus();
    };
    if (event.key === "ArrowDown" || event.key === "j") {
      move((i + 1) % items.length);
    } else if (event.key === "ArrowUp" || event.key === "k") {
      move((i - 1 + items.length) % items.length);
    } else if (event.key === "Home") {
      move(0);
    } else if (event.key === "End") {
      move(items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      postChooseLayout(document.activeElement.dataset.name);
    } else if (
      event.key === "Escape" ||
      event.key === "Tab" ||
      // Left/Right are the toolbar navigation keys; close so focus returns
      // to the Layout button rather than jumping to the first/last button.
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      closeLayoutMenu();
    }
  });

  // Left/Right and j/k move between buttons like Tab does; l is the
  // layout key, so the vim pair is j/k rather than h/l.
  const navOffset = (key) =>
    key === "ArrowLeft" || key === "k"
      ? -1
      : key === "ArrowRight" || key === "j"
        ? 1
        : 0;
  const toolbarButtons = () => Array.from(toolbar.querySelectorAll("button"));
  // Tab would otherwise run off the end of the webview; wrap it instead.
  toolbar.addEventListener("keydown", (event) => {
    const offset = navOffset(event.key);
    if (event.key !== "Tab" && offset === 0) {
      return;
    }
    const buttons = toolbarButtons();
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) {
      return;
    }
    event.preventDefault();
    const direction = event.key === "Tab" ? (event.shiftKey ? -1 : 1) : offset;
    buttons[(i + direction + buttons.length) % buttons.length].focus();
  });

  // VS Code may treat the webview as one tab stop: route Tab, arrows and j/k
  // into the toolbar from anywhere; the menu's Tab-close refocuses the layout
  // button, which the contains-guard then respects, and its own j/k and
  // Left/Right close already handled those keys.
  document.addEventListener("keydown", (event) => {
    const offset = navOffset(event.key);
    if (event.defaultPrevented || (event.key !== "Tab" && offset === 0)) return;
    if (document.activeElement && toolbar.contains(document.activeElement)) {
      return;
    }
    event.preventDefault();
    const buttons = toolbarButtons();
    const last = event.key === "Tab" ? event.shiftKey : offset < 0;
    (last ? buttons[buttons.length - 1] : buttons[0]).focus();
  });

  // Focus leaving the menu, or a pointerdown outside it, dismiss it.
  layoutMenu.addEventListener("focusout", (event) => {
    if (!layoutMenu.contains(event.relatedTarget)) {
      closeLayoutMenu();
    }
  });
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!layoutMenu.hidden && !layoutMenu.contains(event.target)) {
        closeLayoutMenu();
      }
    },
    true,
  );
  let cy = null;
  let pulse = null;
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
  // Space between boxes: along a tier, and between tiers.
  const GAP_ACROSS = 12;
  const GAP_DOWN = 40;
  const measure = document.createElement("canvas").getContext("2d");

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data.type === "empty") {
      clearTimeout(saveTimer);
      clearInterval(pulse);
      if (cy) { cy.destroy(); cy = null; }
      toolbar.hidden = true;
      container.textContent = data.message;
      return;
    }
    if (data.type === "saveDefault") {
      if (cy) {
        clearTimeout(saveTimer);
        postLayout(true);
      }
      return;
    }
    if (data.type === "layoutMenu") {
      openLayoutMenu();
      return;
    }
    if (data.type !== "render" && data.type !== "zoom") {
      return;
    }
    if (data.type === "zoom") {
      // The toolbar zoom buttons; zooming about the view's centre. The zoom
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
    layouts = data.layouts ?? [];
    currentLayout = data.layout ?? "top-down";
    toolbar.hidden = false;
    render(data.elements, data.preset, data.viewport, data.layout, data.dark, data.fontSize);
  });

  window.addEventListener("resize", () => { if (cy) { cy.resize(); } });

  function nodeIndex(node) {
    const i = Number(node.id().slice(1));
    return Number.isInteger(i) ? i : undefined;
  }

  // The whole arrangement — positions and viewport — goes to the host on
  // drag end, and debounced after the user zooms or pans.
  function postLayout(asDefault) {
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
      asDefault: asDefault === true,
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

  // Box-derived spacing: "across" steps between siblings in a tier, "down"
  // between tiers; left-right turns tiers into columns.
  function spacing(layoutName) {
    const dims = cy.nodes().map((node) => node.layoutDimensions({}));
    const widest = Math.max(...dims.map((d) => d.w));
    const tallest = Math.max(...dims.map((d) => d.h));
    const unit = Math.max(widest, tallest);
    return layoutName === "left-right"
      ? { unit, across: tallest + GAP_ACROSS, down: widest + GAP_DOWN }
      : { unit, across: widest + GAP_ACROSS, down: tallest + GAP_DOWN };
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
    // A collapsed boundingBox leaves avoidOverlap's minimum (unit, the
    // largest box side) as every step; transform rescales each axis to the
    // boxes so the graph packs tight instead of stretching to the sidebar.
    const { unit, across, down } = spacing(name);
    return {
      name: "breadthfirst",
      directed: true,
      // No maximal: in cytoscape 3.35 it throws when a node leaves a shared
      // tier, leaving every box stacked at the origin.
      avoidOverlap: true,
      spacingFactor: 1,
      boundingBox: { x1: 0, y1: 0, w: 1, h: 1 },
      roots: elements
        .filter((e) => e.group === "nodes" && !incoming.has(e.data.id))
        .map((e) => e.data.id),
      transform: (node, pos) => {
        const x = (pos.x * across) / unit;
        const y = (pos.y * down) / unit;
        return name === "left-right" ? { x: y, y: x } : { x, y };
      },
    };
  }

  // Tasks added since the arrangement was saved: each goes one tier past
  // its placed upstream tasks (else one before its downstream ones),
  // centred on them, else beside the graph's last tier; then it steps along
  // the tier until it overlaps nothing.
  function placeNew(missing, layoutName) {
    const leftRight = layoutName === "left-right";
    const depthOf = (p) => (leftRight ? p.x : p.y);
    const crossOf = (p) => (leftRight ? p.y : p.x);
    const at = (depth, cross) =>
      leftRight ? { x: depth, y: cross } : { x: cross, y: depth };
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    const { across, down } = spacing(layoutName);
    let placed = cy.nodes().filter((node) => !missing.has(node.id()));
    let pending = cy.nodes().filter((node) => missing.has(node.id()));
    while (pending.nonempty()) {
      // Nodes touching the placed graph first, so a chain of new tasks grows
      // out from it instead of starting beside it.
      const node =
        pending.filter((n) =>
          n.neighborhood("node").intersection(placed).nonempty(),
        )[0] ?? pending[0];
      const ups = node.incomers("node").intersection(placed);
      const downs = node.outgoers("node").intersection(placed);
      let depth;
      let cross;
      if (ups.nonempty()) {
        depth = Math.max(...ups.map((n) => depthOf(n.position()))) + down;
        cross = mean(ups.map((n) => crossOf(n.position())));
      } else if (downs.nonempty()) {
        depth = Math.min(...downs.map((n) => depthOf(n.position()))) - down;
        cross = mean(downs.map((n) => crossOf(n.position())));
      } else {
        const all = placed.map((n) => n.position());
        depth = Math.max(...all.map(depthOf));
        cross = Math.max(...all.map(crossOf)) + across;
      }
      const overlaps = (p) =>
        placed.some((other) => {
          const o = other.position();
          return (
            Math.abs(o.x - p.x) <
              (other.outerWidth() + node.outerWidth()) / 2 + GAP_ACROSS &&
            Math.abs(o.y - p.y) <
              (other.outerHeight() + node.outerHeight()) / 2 + GAP_ACROSS
          );
        });
      while (overlaps(at(depth, cross))) {
        cross += across;
      }
      node.position(at(depth, cross));
      placed = placed.union(node);
      pending = pending.difference(node);
    }
  }

  // Plain nodes have no padding, and cytoscape's width/height "label" is
  // deprecated and hugs the text; measure each label and size the box
  // around it instead.
  function render(elements, preset, viewport, layoutName, dark, fontSize) {
    clearTimeout(saveTimer);
    clearInterval(pulse);
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
        { selector: "node.running", style: {
          "background-color": "#fabd2f",
          "border-width": 2,
          "border-style": "dashed",
        } },
        { selector: "node.running.pulse", style: { "border-width": 4 } },
        { selector: "edge", style: {
          width: 1.5,
          "line-color": line,
          "target-arrow-color": line,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        } },
      ],
    });
    const running = cy.nodes(".running");
    if (
      running.nonempty() &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      pulse = setInterval(() => running.toggleClass("pulse"), 600);
    }
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
      tip.style.top = Math.round(container.offsetTop + p.y + 14) + "px";
      tip.style.display = "block";
    });
    cy.on("mouseout", "node", () => {
      tip.style.display = "none";
    });
    if (preset) {
      cy.resize();
      const missing = new Set(
        elements
          .filter((e) => e.group === "nodes" && !e.position)
          .map((e) => e.data.id),
      );
      placeNew(missing, layoutName);
      // destroy() resets pan/zoom; restore the saved viewport so refreshes
      // keep the user's view, fitting only when none is saved yet.
      restoring = true;
      if (viewport && Number.isFinite(viewport.zoom) && viewport.pan) {
        cy.zoom(viewport.zoom);
        cy.pan(viewport.pan);
        // A newly placed task may sit outside the saved view; widen to it.
        const added = cy.nodes().filter((node) => missing.has(node.id()));
        const view = cy.extent();
        const box = added.boundingBox();
        if (
          added.nonempty() &&
          (box.x1 < view.x1 || box.x2 > view.x2 ||
            box.y1 < view.y1 || box.y2 > view.y2)
        ) {
          cy.fit(undefined, 30);
        }
      } else {
        cy.fit(undefined, 30);
      }
      restoring = false;
      if (missing.size > 0) {
        postLayout();
      }
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

  window.addEventListener("focus", () => {
    vscode.postMessage({ type: "focus", focused: true });
  });
  window.addEventListener("blur", () => {
    vscode.postMessage({ type: "focus", focused: false });
  });

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
  private running: ReadonlySet<string> = new Set();
  private defaultRequested = false;
  // focusedView misses webview iframes, so the graph sets its own context
  // key from focus messages.
  focused = false;
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
      if (typeof message !== "object" || message === null) {
        return;
      }
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
        this.saveLayout(
          message.positions,
          message.zoom,
          message.pan,
          message.asDefault === true && this.defaultRequested,
        );
        if (message.asDefault === true) {
          this.defaultRequested = false;
        }
      }
      if (message.type === "focus") {
        this.focused = message.focused === true;
        void vscode.commands.executeCommand(
          "setContext",
          "pdp.graphFocused",
          this.focused,
        );
      }
      if (message.type === "chooseLayout" && typeof message.name === "string") {
        void this.chooseLayout(message.name);
      }
      if (message.type === "toolbar") {
        this.toolbarAction(message.action);
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
        this.focused = false;
        void vscode.commands.executeCommand(
          "setContext",
          "pdp.graphFocused",
          false,
        );
      }
    });
  }

  update(
    status: ProjectStatus | null,
    running: ReadonlySet<string> = new Set(),
  ): void {
    this.status = status;
    this.running = running;
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
          ? "No tasks in this project yet. Create one with pdp: Create Task."
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
  private saveLayout(
    positions: unknown,
    zoom: unknown,
    pan: unknown,
    asDefault: boolean,
  ): void {
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
      const arrangement: SavedArrangement = { positions: accepted };
      if (viewport) {
        arrangement.viewport = viewport;
      }
      // Arrangement saves must not clobber the chosen layout name or default.
      const current = validLayout(
        this.storage.get<GraphLayout>(positionsKey(root)),
      );
      const layout: GraphLayout = { ...arrangement };
      if (current.layout) {
        layout.layout = current.layout;
      }
      const saved = asDefault ? arrangement : current.saved;
      if (saved) {
        layout.saved = saved;
      }
      void this.storage.update(positionsKey(root), layout);
      if (asDefault) {
        vscode.window.setStatusBarMessage("pdp: Layout saved as default", 4000);
      }
    }
  }

  // The webview answers with a positions message flagged asDefault, so
  // even an untouched automatic layout or a pending zoom is captured.
  saveDefault(): void {
    if (!this.view || !this.status?.tasks.length) {
      void vscode.window.showInformationMessage(
        "pdp: Open the Graph view with tasks shown to save its layout.",
      );
      return;
    }
    this.defaultRequested = true;
    void this.view.webview.postMessage({ type: "saveDefault" });
  }

  // The user's way back: to their saved default if there is one, otherwise
  // to the automatic layout (keeping the chosen layout name). Runs and
  // refreshes never touch it.
  async resetLayout(): Promise<void> {
    const root = workspaceRoot();
    const current = validLayout(
      root ? this.storage.get<GraphLayout>(positionsKey(root)) : undefined,
    );
    const reset: GraphLayout = current.saved
      ? { ...current.saved, saved: current.saved }
      : { positions: {} };
    if (current.layout) {
      reset.layout = current.layout;
    }
    if (root) {
      await this.storage.update(positionsKey(root), reset);
    }
    const label =
      GRAPH_LAYOUTS.find((layout) => layout.name === reset.layout)?.label ??
      GRAPH_LAYOUTS[0].label;
    vscode.window.setStatusBarMessage(
      current.saved
        ? "pdp: Layout reset to saved default"
        : `pdp: Layout reset to ${label}`,
      4000,
    );
    this.pushStatus();
  }

  // The toolbar lives in the webview because title-bar clicks near it often
  // hit the pane header and collapse the view. Its action name is untrusted.
  private toolbarAction(action: unknown): void {
    const actions: Record<string, () => unknown> = {
      zoomIn: () => this.zoomBy(1.25),
      zoomOut: () => this.zoomBy(1 / 1.25),
      save: () => this.saveDefault(),
      reset: () => this.resetLayout(),
    };
    if (typeof action === "string" && Object.hasOwn(actions, action)) {
      void actions[action]();
    }
  }

  // The webview's own menu needs the host to say when: the keybinding
  // path calls this, and the palette falls back to the QuickPick.
  openLayoutMenu(): boolean {
    if (!this.view || !this.focused) {
      return false;
    }
    void this.view.webview.postMessage({ type: "layoutMenu" });
    return true;
  }

  // Zoom buttons; the webview centres the zoom and the existing save path
  // persists the result.
  zoomBy(factor: number): void {
    void this.view?.webview.postMessage({ type: "zoom", factor });
  }

  // Switching the automatic layout means new geometry: the old positions
  // and viewport go, but the saved default stays for Reset to return to.
  async chooseLayout(name: string): Promise<void> {
    const root = workspaceRoot();
    const layoutName = validLayoutName(name);
    if (!root || !layoutName) {
      return;
    }
    const current = validLayout(
      this.storage.get<GraphLayout>(positionsKey(root)),
    );
    const chosen: GraphLayout = { positions: {}, layout: layoutName };
    if (current.saved) {
      chosen.saved = current.saved;
    }
    await this.storage.update(positionsKey(root), chosen);
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
      elements: graphElements(this.status, layout.positions, this.running),
      ids: this.status.tasks.map((task) => task.id),
      labels: nodeLabels(this.status, this.running),
      // preset restores saved positions and the saved viewport, and the
      // webview places any task added since next to its neighbours; the
      // stored layout name runs only when nothing is saved.
      preset: this.status.tasks.some(
        (task) => layout.positions[task.id] !== undefined,
      ),
      viewport: layout.viewport,
      layout: layout.layout ?? "top-down",
      layouts: GRAPH_LAYOUTS.map(({ label, description, name }) => ({
        label,
        description,
        name,
      })),
      dark,
      fontSize: graphFontSize(),
    });
  }

  dispose(): void {
    this.themeListener.dispose();
    this.configListener.dispose();
  }
}
