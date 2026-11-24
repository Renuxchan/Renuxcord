/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// End-to-end check without Discord: the real RenuxBridge HTTP server (native.ts, built with an Electron shim),
// a fake renderer answering requests, and the real MCP server spoken to over stdio.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const tmp = mkdtempSync(join(tmpdir(), "renuxbridge-"));

const { build } = await import(pathToFileURL(join(repo, "node_modules/esbuild/lib/main.js")).href);

writeFileSync(join(tmp, "electron.cjs"), "module.exports = { app: { on() {}, getPath: () => __dirname } };");
writeFileSync(join(tmp, "constants.cjs"), `module.exports = { DATA_DIR: ${JSON.stringify(tmp)} };`);

await build({
    entryPoints: [join(repo, "src/plugins/renuxBridge/native.ts")],
    outfile: join(tmp, "native.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "error",
    alias: { "electron": join(tmp, "electron.cjs"), "@main/utils/constants": join(tmp, "constants.cjs") }
});

const native = (await import(pathToFileURL(join(tmp, "native.cjs")).href)).default;

let passed = 0;
const check = async (name, fn) => {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
};

// Fake renderer: answers like the plugin would
let rendererOn = true;
const handled = [];
(async () => {
    while (rendererOn) {
        const req = await native.poll();
        if (!req) continue;
        handled.push(req.method);
        if (req.method === "listServers") native.reply(null, req.id, true, [{ id: "1", name: "Test Server", query: req.params.query ?? null }]);
        else if (req.method === "status") native.reply(null, req.id, true, { user: { username: "tester" } });
        else if (req.method === "createEmoji") native.reply(null, req.id, true, { gotDataUri: String(req.params.image).startsWith("data:image/png;base64,") });
        else if (req.method === "setOnboarding") native.reply(null, req.id, true, { params: req.params });
        else native.reply(null, req.id, false, `Unknown method "${req.method}"`);
    }
})();

const { port } = await native.start(null, 0);
const bridgeFile = join(tmp, "bridge.json");
const { token } = JSON.parse(readFileSync(bridgeFile, "utf8"));
const url = `http://127.0.0.1:${port}`;

console.log(`bridge on ${url}`);

await check("rejects requests without the token", async () => {
    const res = await fetch(`${url}/status`);
    assert.equal(res.status, 403);
});

await check("rejects browser requests (Origin header) even with the token", async () => {
    const res = await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ method: "status" })
    });
    assert.equal(res.status, 403);
});

await check("rejects a wrong token of the same length", async () => {
    const res = await fetch(`${url}/status`, { headers: { Authorization: `Bearer ${"0".repeat(token.length)}` } });
    assert.equal(res.status, 403);
});

await check("status works with the token", async () => {
    const res = await fetch(`${url}/status`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.result.rendererConnected, true);
});

// MCP server over stdio
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [process.env.RENUXCORD_MCP_ENTRY ?? join(repo, "mcp/src/index.mjs")],
    env: { ...process.env, RENUXCORD_BRIDGE_FILE: bridgeFile }
}));

await check("MCP lists all tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    for (const n of ["status", "create_server", "apply_layout", "export_layout", "set_permissions", "add_emoji", "delete_server", "get_onboarding", "set_onboarding"])
        assert.ok(names.includes(n), `missing tool ${n}`);
    assert.ok(tools.find(t => t.name === "delete_server").annotations?.destructiveHint);
    console.log(`      ${tools.length} tools`);
});

await check("MCP lists prompts", async () => {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map(p => p.name).sort(), ["audit_server", "build_server"]);
});

await check("tool call goes MCP -> bridge -> renderer and back", async () => {
    const res = await client.callTool({ name: "list_servers", arguments: { query: "Test" } });
    assert.ok(!res.isError, res.content?.[0]?.text);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data[0].name, "Test Server");
    assert.equal(data[0].query, "Test");
});

await check("status tool merges bridge and Discord info", async () => {
    const res = await client.callTool({ name: "status", arguments: {} });
    assert.ok(!res.isError, res.content?.[0]?.text);
    const data = JSON.parse(res.content[0].text);
    assert.equal(data.user.username, "tester");
    assert.equal(data.bridge.client, "Renuxcord");
});

await check("local image files are turned into data URIs", async () => {
    const png = join(tmp, "dot.png");
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));
    const res = await client.callTool({ name: "add_emoji", arguments: { server: "Test", name: "dot", image: png } });
    assert.ok(!res.isError, res.content?.[0]?.text);
    assert.equal(JSON.parse(res.content[0].text).gotDataUri, true);
});

await check("set_onboarding passes a full setup through unchanged", async () => {
    const args = {
        server: "Test",
        enabled: true,
        mode: "default",
        default_channel_ids: ["general", "123456789012345678"],
        prompts: [{
            title: "Who's your Azumanga girl?",
            type: "multiple_choice",
            single_select: true,
            required: false,
            in_onboarding: true,
            options: [
                { title: "Osaka", description: "Spaced out", emoji: "🌀", role_ids: ["Osaka"], channel_ids: ["osaka"] },
                { id: "223456789012345678", title: "Chiyo", emoji: null, role_ids: ["Chiyo"] }
            ]
        }]
    };
    const res = await client.callTool({ name: "set_onboarding", arguments: args });
    assert.ok(!res.isError, res.content?.[0]?.text);
    assert.deepEqual(JSON.parse(res.content[0].text).params, args);
});

await check("set_onboarding rejects a question without answers", async () => {
    const res = await client.callTool({ name: "set_onboarding", arguments: { server: "Test", prompts: [{ title: "Empty", options: [] }] } }).catch(e => ({ isError: true, content: [{ text: e.message }] }));
    assert.equal(res.isError, true);
});

await check("renderer errors come back as tool errors", async () => {
    const res = await client.callTool({ name: "get_server", arguments: { server: "x" } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Unknown method/);
});

await check("schema validation rejects bad arguments", async () => {
    const res = await client.callTool({ name: "add_emoji", arguments: { server: "x", name: "bad name!", image: "x" } }).catch(e => ({ isError: true, content: [{ text: e.message }] }));
    assert.equal(res.isError, true);
});

await check("a request times out cleanly when Discord doesn't answer", async () => {
    rendererOn = false;
    await new Promise(r => setTimeout(r, 50));
    native.stop();
    const again = await native.start(null, 0);
    const { token: t2 } = JSON.parse(readFileSync(bridgeFile, "utf8"));
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${again.port}/rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t2}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method: "status", timeoutMs: 1200 })
    });
    const body = await res.json();
    assert.equal(res.status, 504);
    assert.match(body.error, /not answering|did not finish/);
    assert.ok(Date.now() - started < 5000);
});

await check("stopping removes bridge.json", async () => {
    native.stop();
    assert.throws(() => readFileSync(bridgeFile));
});

await client.close();
console.log(`\n${passed} checks passed`);
process.exit(0);
