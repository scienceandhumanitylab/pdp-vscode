import * as vscode from "vscode";
import type { ProjectStatus, TaskStatus } from "./pdp";

export class TaskItem extends vscode.TreeItem {
  constructor(readonly task: TaskStatus) {
    super(
      task.id,
      TaskItem.hasDetail(task)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.description = [task.stale ? "stale" : "fresh", task.description]
      .filter(Boolean)
      .join(" · ");
    this.iconPath = task.stale
      ? new vscode.ThemeIcon(
          "sync",
          new vscode.ThemeColor("editorWarning.foreground"),
        )
      : new vscode.ThemeIcon(
          "check",
          new vscode.ThemeColor("testing.iconPassed"),
        );
    this.contextValue = "task";
    this.command = {
      command: "pdp.openTask",
      title: "Open task.yml",
      arguments: [this],
    };
    this.tooltip = this.tooltipText();
  }

  private static hasDetail(task: TaskStatus): boolean {
    return (
      task.depends_on.length > 0 ||
      !!task.entrypoint ||
      Object.keys(task.slurm).length > 0
    );
  }

  private tooltipText(): string {
    const lines = [`${this.task.id} — ${this.task.stale ? "stale" : "fresh"}`];
    if (this.task.description) {
      lines.push(this.task.description);
    }
    if (this.task.depends_on.length) {
      lines.push(`depends on: ${this.task.depends_on.join(", ")}`);
    }
    if (this.task.entrypoint) {
      lines.push(`entrypoint: ${this.task.entrypoint}`);
    }
    if (Object.keys(this.task.slurm).length) {
      lines.push(
        `slurm: ${Object.entries(this.task.slurm)
          .map(([key, value]) => `${key} ${value}`)
          .join(", ")}`,
      );
    }
    return lines.join("\n");
  }

  childItems(): vscode.TreeItem[] {
    const children: vscode.TreeItem[] = [];
    if (this.task.depends_on.length) {
      children.push(
        detailItem(
          `depends on: ${this.task.depends_on.join(", ")}`,
          "references",
        ),
      );
    }
    if (this.task.entrypoint) {
      children.push(
        detailItem(`entrypoint: ${this.task.entrypoint}`, "terminal"),
      );
    }
    if (Object.keys(this.task.slurm).length) {
      children.push(
        detailItem(
          `slurm: ${Object.entries(this.task.slurm)
            .map(([key, value]) => `${key} ${value}`)
            .join(", ")}`,
          "server-process",
        ),
      );
    }
    return children;
  }
}

function detailItem(label: string, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

export class PdpTasksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  private current: ProjectStatus | null = null;

  update(status: ProjectStatus | null): void {
    this.current = status;
    this.change.fire();
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof TaskItem) {
      return element.childItems();
    }
    if (!this.current) {
      return [];
    }
    return this.current.tasks.map((task) => new TaskItem(task));
  }
}
