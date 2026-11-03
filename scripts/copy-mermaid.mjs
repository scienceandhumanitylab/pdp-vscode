import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("media", { recursive: true });
copyFileSync(
  "node_modules/mermaid/dist/mermaid.min.js",
  "media/mermaid.min.js",
);
