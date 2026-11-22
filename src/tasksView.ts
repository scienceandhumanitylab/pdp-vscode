import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { workspaceRoot, type ProjectStatus, type TaskStatus } from "./pdp";

// pdp output is untrusted: a crafted id must not escape the workspace root
export function taskFolderPath(root: string, id: string): string | undefined {
  return /[\\/]|\.\./.test(id) ? undefined : path.join(root, id);
}

export function missingTaskFolders(
  status: ProjectStatus,
  root: string,
  exists: (folder: string) => boolean = fs.existsSync,
): string[] {
  return status.tasks
    .map((task) => task.id)
    .filter((id) => {
      const folder = taskFolderPath(root, id);
      return folder !== undefined && !exists(folder);
    });
}

function isDirectory(fsPath: string): boolean {
  try {
    return fs.statSync(fsPath).isDirectory();
  } catch {
    return false; // broken symlink
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(readonly fsPath: string) {
    const folder = isDirectory(fsPath);
    super(
      path.basename(fsPath),
      folder
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.resourceUri = vscode.Uri.file(fsPath);
    this.iconPath = folder ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    this.tooltip = fsPath;
    if (!folder) {
      this.command = {
        command: "vscode.open",
        title: "Open file",
        arguments: [this.resourceUri],
      };
    }
  }

  childItems(): FileItem[] {
    return listFolder(this.fsPath);
  }
}

function listFolder(folder: string): FileItem[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const items = names.map((name) => new FileItem(path.join(folder, name)));
  const isFolder = (item: FileItem) =>
    item.collapsibleState !== vscode.TreeItemCollapsibleState.None;
  return items.sort(
    (a, b) =>
      Number(isFolder(b)) - Number(isFolder(a)) ||
      String(a.label).localeCompare(String(b.label)),
  );
}

export class TaskItem extends vscode.TreeItem {
  readonly folder: string | undefined;

  constructor(readonly task: TaskStatus) {
    const root = workspaceRoot();
    const folder = root ? taskFolderPath(root, task.id) : undefined;
    super(
      task.id,
      TaskItem.hasDetail(task) || (folder && fs.existsSync(folder))
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.folder = folder;
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
    return Object.keys(task.slurm).length > 0;
  }

  private tooltipText(): string {
    const lines = [`${this.task.id} — ${this.task.stale ? "stale" : "fresh"}`];
    if (this.task.description) {
      lines.push(this.task.description);
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

  // Task.yml (opened by clicking the task) is where dependencies and the
  // entrypoint are read; the tree only repeats what has no other home.
  childItems(): vscode.TreeItem[] {
    const children: vscode.TreeItem[] = [];
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
    return this.folder ? [...children, ...listFolder(this.folder)] : children;
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

  // TreeView.reveal walks up to the root, so parents must be resolvable.
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof FileItem) {
      const root = workspaceRoot();
      const parentDir = path.dirname(element.fsPath);
      const task = this.current?.tasks.find(
        (candidate) =>
          root !== undefined &&
          taskFolderPath(root, candidate.id) === parentDir,
      );
      if (task) {
        return new TaskItem(task);
      }
      if (root && parentDir !== root) {
        return new FileItem(parentDir);
      }
    }
    return undefined;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof TaskItem || element instanceof FileItem) {
      return element.childItems();
    }
    if (!this.current) {
      return [];
    }
    const root = workspaceRoot();
    const tasks = this.current.tasks.map((task) => new TaskItem(task));
    return root ? [new FileItem(path.join(root, "pdp.yml")), ...tasks] : tasks;
  }
}
