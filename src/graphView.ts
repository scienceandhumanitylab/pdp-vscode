import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { ProjectStatus } from "./pdp";

// Node ids are generated (n0, n1, ...) so task ids with characters mermaid
// rejects cannot break the diagram; the extension maps them back by index.
export function mermaidDefinition(status: ProjectStatus): string {
  const index = new Map(status.tasks.map((task, i) => [task.id, i]));
  const lines = [
    "flowchart TD",
    "classDef stale fill:#f6d18b,stroke:#7a5b16,color:#111111",
    "classDef fresh fill:#cbe6c0,stroke:#2e5c3a,color:#111111",
  ];
  status.tasks.forEach((task, i) => {
    const label = `${task.id.replace(/"/g, "#quot;")} (${
      task.stale ? "stale" : "fresh"
    })`;
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
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

  window.addEventListener("message", (event) => {
    const { type, def, dark, message } = event.data;
    if (type === "empty") {
      container.textContent = message;
      return;
    }
    if (type !== "render") {
      return;
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
    mermaid
      .render("pdp-graph", def)
      .then(({ svg }) => {
        container.innerHTML = svg;
        vscode.postMessage({ type: "rendered" });
      })
      .catch((err) => {
        container.textContent = "Could not render the graph: " + err;
      });
  });

  container.addEventListener("click", (event) => {
    const node = event.target.closest(".node");
    const match = node && node.id ? node.id.match(/n\\d+/) : null;
    if (match) {
      vscode.postMessage({ type: "openTask", node: match[0] });
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
  private readonly themeListener: vscode.Disposable;
  private renderedResolve!: (rendered: boolean) => void;
  /** Resolves true once the webview has rendered a graph (test hook). */
  readonly rendered: Promise<boolean>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    onOpenTask: (id: string) => void,
  ) {
    this.onOpenTask = onOpenTask;
    this.rendered = new Promise<boolean>((resolve) => {
      this.renderedResolve = resolve;
    });
    this.themeListener = vscode.window.onDidChangeActiveColorTheme(() =>
      this.push(),
    );
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
      if (message.type === "openTask") {
        const task = this.status?.tasks[Number(message.node.slice(1))];
        if (task) {
          this.onOpenTask(task.id);
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
      dark,
    });
  }

  dispose(): void {
    this.themeListener.dispose();
  }
}
