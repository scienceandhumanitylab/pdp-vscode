import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const emptyTree: vscode.TreeDataProvider<vscode.TreeItem> = {
  getTreeItem: (item) => item,
  getChildren: () => [],
};

const stubbedCommands = [
  "pdp.init",
  "pdp.create",
  "pdp.scaffold",
  "pdp.validate",
  "pdp.refresh",
  "pdp.runAll",
  "pdp.runPick",
  "pdp.runTask",
  "pdp.runOnly",
  "pdp.runFrom",
  "pdp.runForce",
  "pdp.runSlurm",
  "pdp.cleanTask",
  "pdp.cleanAll",
  "pdp.openTask",
  "pdp.revealTask",
  "pdp.graph",
  "pdp.dagsterLocal",
  "pdp.dagsterSlurm",
  "pdp.remoteStart",
  "pdp.remoteRunAll",
  "pdp.remoteRunTask",
  "pdp.remotePush",
  "pdp.remotePull",
  "pdp.remoteStop",
  "pdp.remoteRefresh",
  "pdp.openDagsterUi",
  "pdp.stopProcess",
];

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    ...stubbedCommands.map((id) =>
      vscode.commands.registerCommand(id, () => {
        vscode.window.showInformationMessage(
          `PDP: ${id.replace("pdp.", "")} is not implemented yet.`,
        );
      }),
    ),
    vscode.window.createTreeView("pdp.tasks", { treeDataProvider: emptyTree }),
    vscode.window.createTreeView("pdp.remote", { treeDataProvider: emptyTree }),
  );
  vscode.commands.executeCommand(
    "setContext",
    "pdp.hasProject",
    hasPdpProject(),
  );
}

export function hasPdpProject(): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return !!root && fs.existsSync(path.join(root, "pdp.yml"));
}

export function deactivate() {}
