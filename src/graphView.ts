import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { ProjectStatus, TaskStatus } from "./pdp";

// Node ids are generated (n0, n1, ...) so task ids with characters mermaid
// rejects cannot break the diagram; the extension maps them back by index.
export function mermaidDefinition(status: ProjectStatus): string {
  const index = new Map(status.tasks.map((task, i) => [task.id, i]));
  const lines = [
    "flowchart TD",
    "classDef stale fill:#f48f84,stroke:#3c3836,color:#000000",
    "classDef fresh fill:#83a598,stroke:#3c3836,color:#000000",
  ];
  status.tasks.forEach((task, i) => {
    const label = `${task.id.replace(/"/g, "#quot;")} ${
      task.stale ? "✗" : "✓"
    }`;
    lines.push(`  n${i}["${label}"]:::${task.stale ? "stale" : "fresh"}`);
  });
  status.tasks.forEach((task, i) => {
    for (const dep of task.depends_on) {
      const j = index.get(dep);
      if (j !== undefined) {
        lines.push(`  n${j} --> n${i}`);
      }
    }
  });
  return lines.join("\n");
}

// Hover text per node, in node order (n0, n1, ...): the label is shrunk to
// "id ✗/✓" for the narrow sidebar, so the state in words moves to the
// SVG <title> the webview appends after each render.
export function nodeLabels(status: ProjectStatus): string[] {
  return status.tasks.map(
    (task) => `${task.id} (${task.stale ? "stale" : "fresh"})`,
  );
}

// Invalid or missing settings fall back to the schema default rather than
// producing unreadable or negative-size text.
function graphFontSize(): number {
  const size = vscode.workspace
    .getConfiguration("pdp")
    .get<number>("graphFontSize");
  return typeof size === "number" && size > 0 ? size : 16;
}

function html(webview: vscode.Webview, nonce: string, scriptUri: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
</head>
<body>
<div id="graph" role="img" aria-label="PDP task graph"></div>
<script src="${scriptUri}"></script>
<script type="module" nonce="${nonce}">
  const mermaid = globalThis.mermaid;
  const container = document.getElementById("graph");
  const vscode = acquireVsCodeApi();

  window.addEventListener("message", (event) => {
    const { type, def, dark, labels, fontSize, message } = event.data;
    if (type === "empty") {
      container.textContent = message;
      return;
    }
    if (type !== "render") {
      return;
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      themeVariables: { fontSize: (fontSize ?? 14) + "px" },
      // flowchart.padding is the label-to-box gap (mermaid default 15);
      // small keeps the boxes snug to the text in the narrow sidebar.
      flowchart: { nodeSpacing: 30, rankSpacing: 35, padding: 4, useMaxWidth: true },
    });
    mermaid
      .render("pdp-graph", def)
      .then(({ svg }) => {
        container.innerHTML = svg;
        // Labels passed in, not module state: render is async, so a newer
        // message must not swap the titles of an older in-flight SVG.
        addNodeTitles(labels ?? []);
        vscode.postMessage({ type: "rendered" });
      })
      .catch((err) => {
        container.textContent = "Could not render the graph: " + err;
      });
  });

  function nodeIndex(node) {
    const match = node && node.id ? node.id.match(/n\\d+/) : null;
    return match ? Number(match[0].slice(1)) : undefined;
  }

  function addNodeTitles(labels) {
    container.querySelectorAll(".node").forEach((node) => {
      const label = labels[nodeIndex(node)];
      if (label === undefined) {
        return;
      }
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = label;
      node.appendChild(title);
    });
  }

  container.addEventListener("click", (event) => {
    const i = nodeIndex(event.target.closest(".node"));
    if (i !== undefined) {
      vscode.postMessage({ type: "openTask", node: "n" + i });
    }
  });

  container.addEventListener("contextmenu", (event) => {
    const i = nodeIndex(event.target.closest(".node"));
    if (i !== undefined) {
      event.preventDefault();
      vscode.postMessage({ type: "taskMenu", node: "n" + i });
    }
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
  private readonly onOpenTask: (id: string) => void;
  private readonly onTaskMenu: (id: string) => void;
  private readonly themeListener: vscode.Disposable;
  private readonly configListener: vscode.Disposable;
  private renderedResolve!: (rendered: boolean) => void;
  /** Resolves true once the webview has rendered a graph (test hook). */
  readonly rendered: Promise<boolean>;

  constructor(
    private readonly extensionUri: vscode.Uri,
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
          vscode.Uri.joinPath(this.extensionUri, "media", "mermaid.min.js"),
        )
        .toString(),
    );
    view.webview.onDidReceiveMessage((message) => {
      if (message.type === "ready") {
        this.status ? this.push() : this.pushEmpty();
      }
      if (message.type === "rendered") {
        this.renderedResolve(true);
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
    if (!this.view) {
      return;
    }
    if (this.status) {
      this.push();
    } else {
      this.pushEmpty();
    }
  }

  private taskAt(node: unknown): TaskStatus | undefined {
    if (typeof node !== "string" || !/^n\d+$/.test(node)) {
      return undefined;
    }
    return this.status?.tasks[Number(node.slice(1))];
  }

  private pushEmpty(): void {
    void this.view?.webview.postMessage({
      type: "empty",
      message:
        "No pdp project in this workspace. Open a workspace with a pdp.yml, then refresh.",
    });
  }

  private push(): void {
    if (!this.status || !this.view) {
      return;
    }
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind ===
        vscode.ColorThemeKind.HighContrast;
    void this.view.webview.postMessage({
      type: "render",
      def: mermaidDefinition(this.status),
      labels: nodeLabels(this.status),
      dark,
      fontSize: graphFontSize(),
    });
  }

  dispose(): void {
    this.themeListener.dispose();
    this.configListener.dispose();
  }
}
