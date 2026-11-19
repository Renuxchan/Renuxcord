/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Bundles the MCP server (mcp/) into one file, dist/renuxcord-mcp.mjs, that ships and updates with Renuxcord.
// Install its dependencies first: pnpm install --dir mcp --ignore-workspace

import { build } from "esbuild";
import { existsSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "../..");
const outfile = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist", "renuxcord-mcp.mjs");

if (!existsSync(join(root, "mcp", "node_modules"))) {
    console.error("mcp/node_modules is missing. Run: pnpm install --dir mcp --ignore-workspace");
    process.exit(1);
}

await build({
    entryPoints: [join(root, "mcp", "src", "index.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: true,
    legalComments: "none",
    logLevel: "info",
    // Some bundled CommonJS dependencies call require() on Node builtins
    banner: {
        js: [
            "// Renuxcord MCP server. Source: mcp/ in the Renuxcord repository. GPL-3.0-or-later",
            'import { createRequire as __rxRequire } from "module"; const require = __rxRequire(import.meta.url);'
        ].join("\n")
    }
});
