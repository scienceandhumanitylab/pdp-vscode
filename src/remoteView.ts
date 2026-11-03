import * as vscode from "vscode";
import type { RemoteStatus } from "./pdp";
import type { ProcessSource, TrackedProcess } from "./processes";

class SectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly section: "remote" | "processes",
    collapsible: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsible);
    this.contextValue = "pdpRemoteSection";
  }
}

export class ProcessItem extends vscode.TreeItem {
  constructor(readonly process: TrackedProcess) {
    super(process.label, vscode.TreeItemCollapsibleState.None);
    this.description = process.url ?? "starting…";
    this.tooltip = `${process.label}\n${process.url ?? "waiting for the UI URL"}`;
    this.contextValue = "process";
    this.iconPath = new vscode.ThemeIcon("server-process");
  }
}

function row(
  label: string,
  description: string,
  icon: string,
): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = description;
  item.tooltip = `${label}: ${description}`;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

export class PdpRemoteProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private status: RemoteStatus | null = null;
  private error: string | null = null;

  constructor(private readonly processes: ProcessSource) {
    processes.onDidChange(() => this.change.fire());
  }

  update(status: RemoteStatus | null, error: string | null = null): void {
    this.status = status;
    this.error = error;
    this.change.fire();
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof SectionItem) {
      return element.section === "remote"
        ? this.remoteRows()
        : this.processes.list().map((proc) => new ProcessItem(proc));
    }
    const sections: vscode.TreeItem[] = [
      new SectionItem(
        "Remote",
        "remote",
        this.status
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      ),
    ];
    if (this.processes.list().length > 0) {
      sections.push(
        new SectionItem(
          "Processes",
          "processes",
          vscode.TreeItemCollapsibleState.Expanded,
        ),
      );
    }
    return sections;
  }

  private remoteRows(): vscode.TreeItem[] {
    if (this.error) {
      const item = new vscode.TreeItem(
        this.error,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("error");
      return [item];
    }
    if (!this.status) {
      const item = new vscode.TreeItem(
        "Not loaded — use Refresh",
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("circle-slash");
      return [item];
    }
    const s = this.status;
    const rows = [
      row("host", s.host, "server"),
      row("path", s.path, "folder"),
      row(
        "port",
        `${s.port}${s.dagster_listening ? " (UI listening)" : ""}`,
        "plug",
      ),
      row("version", s.version, "tag"),
      row("project", s.pushed ? "pushed" : "not pushed", "package"),
      row(
        "session",
        `${s.session.name} — ${s.session.running ? "running" : "stopped"}`,
        "vm",
      ),
    ];
    const last = s.run.last;
    rows.push(
      row(
        "last run",
        s.run.running
          ? "running now"
          : last
            ? `${last.finished ?? "?"} (exit ${last.exit_code ?? "?"}: ran ${
                (last.ran ?? []).length
              }, failed ${(last.failed ?? []).length})`
            : "no runs yet",
        "play",
      ),
    );
    rows.push(
      row(
        "slurm jobs",
        s.jobs === null
          ? "unknown (squeue failed)"
          : s.jobs.length === 0
            ? "none"
            : s.jobs.join(", "),
        "layers",
      ),
    );
    return rows;
  }
}
