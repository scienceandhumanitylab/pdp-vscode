import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("activates and registers every contributed command", async () => {
    const ext = vscode.extensions.getExtension("scienceandhumanitylab.pdp");
    assert.ok(ext, "extension not found");
    await ext.activate();
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "package.json"),
        "utf-8",
      ),
    );
    const contributed: string[] = pkg.contributes.commands.map(
      (c: { command: string }) => c.command,
    );
    assert.ok(contributed.length >= 28);
    const commands = await vscode.commands.getCommands(true);
    for (const id of contributed) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });
});
