import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("media", { recursive: true });
copyFileSync(
  "node_modules/cytoscape/dist/cytoscape.min.js",
  "media/cytoscape.min.js",
);
