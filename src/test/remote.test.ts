import * as assert from "assert";
import * as cp from "child_process";
import * as vscode from "vscode";
import { parseRemoteStatus, type ExecResult, type SpawnedPdp } from "../pdp";
import {
  ProcessRegistry,
  type ProcessSource,
  type TrackedProcess,
} from "../processes";
import { PdpRemoteProvider } from "../remoteView";

const remoteStatusJson = JSON.stringify({
  host: "cluster.example.edu",
  path: "/home/me/demo",
  port: "3002",
  version: "pdp[dagster] @ git+...",
  pushed: true,
  session: { name: "pdp-demo", running: false },
  run: {
    running: false,
    last: {
      finished: "2026-11-01T12:00:00",
      ran: ["fetch"],
      failed: ["clean"],
      no_entrypoint: [],
      exit_code: 1,
    },
  },
  dagster_listening: true,
  jobs: ["123"],
});

suite("remote status parsing", () => {
  test("parseRemoteStatus reads all fields", () => {
    const status = parseRemoteStatus(remoteStatusJson);
    assert.strictEqual(status.host, "cluster.example.edu");
    assert.strictEqual(status.pushed, true);
    assert.strictEqual(status.session.running, false);
    assert.strictEqual(status.run.last?.exit_code, 1);
    assert.deepStrictEqual(status.run.last?.failed, ["clean"]);
    assert.strictEqual(status.dagster_listening, true);
    assert.deepStrictEqual(status.jobs, ["123"]);
  });

  test("parseRemoteStatus accepts null last run and jobs", () => {
    const status = parseRemoteStatus(
      JSON.stringify({
        host: "h",
        path: "/p",
        port: "3002",
        version: "pdp",
        pushed: false,
        session: { name: "pdp-x", running: false },
        run: { running: false, last: null },
        dagster_listening: false,
        jobs: null,
      }),
    );
    assert.strictEqual(status.run.last, null);
    assert.strictEqual(status.jobs, null);
  });

  test("parseRemoteStatus rejects non-remote JSON", () => {
    assert.throws(() => parseRemoteStatus('{"tasks": []}'));
    assert.throws(() => parseRemoteStatus("nope"));
  });
});

class FakeProcesses implements ProcessSource {
  readonly emitter = new vscode.EventEmitter<void>();
  private items: TrackedProcess[] = [];
  readonly onDidChange = this.emitter.event;
  list(): TrackedProcess[] {
    return this.items;
  }
  seed(process: TrackedProcess): void {
    this.items.push(process);
    this.emitter.fire();
  }
}

suite("remote view", () => {
  test("shows remote rows and background processes", async () => {
    const processes = new FakeProcesses();
    const provider = new PdpRemoteProvider(processes);

    // before any refresh: remote section with a hint, no processes section
    const initial = await provider.getChildren();
    assert.strictEqual(initial.length, 1);

    provider.update(parseRemoteStatus(remoteStatusJson));
    const [remoteSection] = await provider.getChildren();
    const rows = await provider.getChildren(remoteSection);
    const byLabel = new Map(
      rows.map((row) => [String(row.label), row.description]),
    );
    assert.strictEqual(byLabel.get("host"), "cluster.example.edu");
    assert.strictEqual(byLabel.get("port"), "3002 (UI listening)");
    assert.strictEqual(byLabel.get("project"), "pushed");
    assert.strictEqual(byLabel.get("session"), "pdp-demo — stopped");
    assert.match(String(byLabel.get("last run")), /exit 1/);
    assert.strictEqual(byLabel.get("slurm jobs"), "123");

    processes.seed({ id: "dagster-local", label: "Dagster (local)" });
    const [, processesSection] = await provider.getChildren();
    const running = await provider.getChildren(processesSection);
    assert.strictEqual(running.length, 1);
    assert.strictEqual(running[0].contextValue, "process");
  });
});

suite("process registry", () => {
  const nodeSpawner =
    (script: string) =>
    (_args: string[], onOutput: (chunk: string) => void): SpawnedPdp => {
      const child = cp.spawn("node", ["-e", script], { detached: true });
      child.stdout?.on("data", (data: Buffer) => onOutput(data.toString()));
      const done = new Promise<ExecResult>((resolve) => {
        child.on("close", (code) =>
          resolve({ code: code ?? 0, stdout: "", stderr: "" }),
        );
      });
      return {
        done,
        kill: (signal = "SIGINT") => {
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, signal);
            } catch {
              // already gone
            }
          }
        },
      };
    };

  test("tracks a process, finds its UI url, and stops it", async () => {
    const registry = new ProcessRegistry(
      nodeSpawner(
        "console.log('Serving UI at http://127.0.0.1:3210'); setInterval(() => {}, 1000);",
      ),
    );
    const urlSeen = new Promise<void>((resolve) => {
      registry.onDidChange(() => {
        if (registry.get("dagster-local")?.url) {
          resolve();
        }
      });
    });
    registry.start("dagster-local", "Dagster (local)", ["unused"]);
    assert.strictEqual(registry.list().length, 1);
    await urlSeen;
    assert.strictEqual(
      registry.get("dagster-local")?.url,
      "http://127.0.0.1:3210",
    );
    registry.stop("dagster-local");
    const gone = new Promise<void>((resolve) => {
      registry.onDidChange(() => {
        if (!registry.get("dagster-local")) {
          resolve();
        }
      });
    });
    await gone;
    assert.deepStrictEqual(registry.list(), []);
  }).timeout(10000);

  test("starting twice is a no-op", () => {
    const registry = new ProcessRegistry(
      nodeSpawner("setInterval(() => {}, 1000);"),
    );
    registry.start("dagster-local", "Dagster (local)", []);
    registry.start("dagster-local", "Dagster (local)", []);
    assert.strictEqual(registry.list().length, 1);
    registry.stopAll();
  });
});
