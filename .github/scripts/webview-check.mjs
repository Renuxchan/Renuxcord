/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// CI only: checks things inside the Android app's WebView over Chrome DevTools (debug builds allow that).
//   node .github/scripts/webview-check.mjs <devtools port>
// Prints one line per check and exits 1 if any failed.
const port = process.argv[2] ?? "9222";

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(p => p.type === "page" && /discord\.com/.test(p.url)) ?? pages.find(p => p.type === "page");
if (!page) {
    console.log("No page in the WebView");
    process.exit(1);
}
console.log(`Page: ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});
let nextId = 0;
const waiting = new Map();
ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    waiting.get(msg.id)?.(msg);
};
const evaluate = expression => new Promise(resolve => {
    const id = ++nextId;
    waiting.set(id, msg => resolve(msg.result?.result?.value ?? msg.result?.exceptionDetails?.text ?? msg.error?.message));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
});

let failed = 0;
async function check(name, expression, ok) {
    const value = await evaluate(expression);
    const passed = ok(value);
    if (!passed) failed++;
    console.log(`${passed ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(value)}`);
}

// The emulator runs without a microphone, so a device error is fine. NotAllowedError means the app refused Discord
await check(
    "Discord may use the microphone (voice calls)",
    `navigator.mediaDevices.getUserMedia({ audio: true })
        .then(s => { s.getTracks().forEach(t => t.stop()); return "ok"; }, e => e.name)`,
    v => typeof v === "string" && v !== "NotAllowedError" && v !== "SecurityError"
);
await check(
    "Discord may use the camera (video calls)",
    `navigator.mediaDevices.getUserMedia({ video: true })
        .then(s => { s.getTracks().forEach(t => t.stop()); return "ok"; }, e => e.name)`,
    v => typeof v === "string" && v !== "NotAllowedError" && v !== "SecurityError"
);
await check(
    "notifications are allowed",
    `typeof Notification === "function" ? Notification.permission : "missing"`,
    v => v === "granted"
);
await check(
    "a notification reaches Android",
    `(() => { const n = new Notification("Renuxcord CI", { body: "Notification check", tag: "ci" }); return n.id > 0 ? "shown" : "no id"; })()`,
    v => v === "shown"
);
await check(
    "the app's hooks are in the page",
    `typeof RenuxcordMobile?.notificationClicked === "function" && typeof RenuxcordMobile?.onBackPress === "function"`,
    v => v === true
);

ws.close();
process.exit(failed ? 1 : 0);
