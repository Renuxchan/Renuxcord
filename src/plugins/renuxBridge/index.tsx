/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { useAwaiter } from "@utils/react";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Modal, openModal, showToast, useEffect, useReducer } from "@webpack/common";

import { ActionContext, actions } from "./actions";
import { sleep } from "./discord";

const Native = VencordNative.pluginHelpers.RenuxBridge as PluginNative<typeof import("./native")>;
const logger = new Logger("RenuxBridge", "#a78bfa");
const cl = classNameFactory("rx-bridge-");

interface ActivityEntry {
    time: number;
    text: string;
    kind: "change" | "step" | "error";
}

const activity: ActivityEntry[] = [];
const activityListeners = new Set<() => void>();

function addActivity(text: string, kind: ActivityEntry["kind"]) {
    activity.unshift({ time: Date.now(), text, kind });
    if (activity.length > 150) activity.length = 150;
    activityListeners.forEach(l => l());
}

function useActivity() {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        activityListeners.add(rerender);
        return () => void activityListeners.delete(rerender);
    }, []);
    return activity;
}

function mcpCommand(mcpFile: string) {
    return `claude mcp add renuxcord --scope user -- node "${mcpFile}"`;
}

function ActivityList({ limit }: { limit: number; }) {
    const entries = useActivity();
    if (!entries.length) return <Paragraph className={cl("muted")}>Nothing yet. Ask your AI to do something in Discord.</Paragraph>;

    return (
        <div className={cl("log")}>
            {entries.slice(0, limit).map((e, i) => (
                <div key={i} className={cl("log-row", `log-${e.kind}`)}>
                    <span className={cl("log-time")}>{new Date(e.time).toLocaleTimeString()}</span>
                    <span>{e.text}</span>
                </div>
            ))}
        </div>
    );
}

function BridgePanel() {
    const [info, , pending] = useAwaiter(() => Native.info(), { fallbackValue: null, deps: [] });

    if (pending || !info) return <Paragraph>Checking the bridge…</Paragraph>;

    return (
        <Flex flexDirection="column" gap={12} className={cl("panel")}>
            <div className={cl("status")}>
                <span className={cl("dot", info.running && info.rendererConnected ? "dot-on" : "dot-off")} />
                {info.running
                    ? <span>Listening on <code>127.0.0.1:{info.port}</code>{info.rendererConnected ? "" : " (waiting for Discord)"}</span>
                    : <span>Not running. Enable the plugin to start it.</span>}
            </div>

            <section>
                <Heading tag="h5">Connect Claude Code</Heading>
                {info.mcpInstalled
                    ? <>
                        <Paragraph className={cl("muted")}>Run this once in a terminal, then start a new Claude Code session:</Paragraph>
                        <pre className={cl("cmd")}>{mcpCommand(info.mcpFile)}</pre>
                        <Button size="small" onClick={() => copyWithToast(mcpCommand(info.mcpFile), "MCP command copied")}>Copy command</Button>
                    </>
                    : <Paragraph className={cl("muted")}>
                        The MCP server file isn't next to Renuxcord yet ({info.mcpFile}). Reinstall or update Renuxcord to get it.
                    </Paragraph>}
            </section>

            <section>
                <Heading tag="h5">Recent activity</Heading>
                <ActivityList limit={25} />
            </section>
        </Flex>
    );
}

function openActivityModal() {
    openModal(props => (
        <Modal
            {...props}
            title="AI Bridge activity"
            subtitle="Everything your AI did in Discord this session"
            actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}
        >
            <ActivityList limit={150} />
        </Modal>
    ));
}

const settings = definePluginSettings({
    allowWrite: {
        type: OptionType.BOOLEAN,
        description: "Allow changes: create and edit servers, channels, roles, permissions, invites, webhooks and emojis",
        default: true
    },
    allowDestructive: {
        type: OptionType.BOOLEAN,
        description: "Allow deleting channels, roles and servers (servers also need their exact name to delete)",
        default: false
    },
    allowMessages: {
        type: OptionType.BOOLEAN,
        description: "Allow messages: read and send messages in server channels (never DMs)",
        default: true
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show a toast whenever the AI changes something",
        default: true
    },
    port: {
        type: OptionType.NUMBER,
        description: "Preferred local port. A free one is picked if it's taken",
        default: 47321,
        restartNeeded: true
    },
    panel: {
        type: OptionType.COMPONENT,
        component: () => <BridgePanel />
    }
});

let running = false;

function toJsonSafe(value: unknown) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
}

async function handle(req: { id: number; method: string; params: any; }) {
    const action = actions[req.method];
    if (!action) return Native.reply(req.id, false, `Unknown method "${req.method}"`);

    const ctx: ActionContext = {
        allowWrite: settings.store.allowWrite,
        allowDestructive: settings.store.allowDestructive,
        allowMessages: settings.store.allowMessages,
        log(text) {
            addActivity(text, "change");
            if (settings.store.showToasts) showToast({ text: `AI · ${text}`, variant: "success" });
        },
        progress: text => addActivity(text, "step")
    };

    try {
        const result = await action(req.params ?? {}, ctx);
        await Native.reply(req.id, true, toJsonSafe(result));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addActivity(`${req.method} failed: ${message}`, "error");
        logger.warn(`${req.method} failed`, err);
        await Native.reply(req.id, false, message);
    }
}

async function pollLoop() {
    while (running) {
        let req: Awaited<ReturnType<typeof Native.poll>>;
        try {
            req = await Native.poll();
        } catch (err) {
            logger.error("Polling the bridge failed", err);
            await sleep(3000);
            continue;
        }

        if (!req) continue;
        if (!running) {
            await Native.reply(req.id, false, "RenuxBridge is stopping");
            break;
        }
        void handle(req);
    }
}

export default definePlugin({
    name: "RenuxBridge",
    description: "AI bridge for Claude Code (MCP): tell your AI to create servers, channels, roles, permissions and whole server layouts and it happens in Discord",
    tags: ["Renuxcord", "Servers", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    settingsAboutComponent: () => (
        <Paragraph>
            Runs a private bridge on <code>127.0.0.1</code> that only local tools holding the token in <code>bridge.json</code> can use.
            Web pages can't reach it. It acts as your account at a human pace and only in server channels. Deleting is off until you switch it on.
        </Paragraph>
    ),

    toolboxActions: {
        "AI Bridge: copy MCP setup command": async () => {
            const info = await Native.info();
            if (!info.mcpInstalled) return showToast({ text: "MCP server file missing, update Renuxcord", variant: "critical" });
            copyWithToast(mcpCommand(info.mcpFile), "MCP command copied");
        },
        "AI Bridge: activity log": openActivityModal
    },

    async start() {
        running = true;
        try {
            const { port } = await Native.start(settings.store.port ?? 47321);
            logger.info(`Bridge listening on 127.0.0.1:${port}`);
            void pollLoop();
        } catch (err) {
            running = false;
            logger.error("Couldn't start the bridge", err);
            showToast({ text: "RenuxBridge couldn't start, check the console", variant: "critical" });
        }
    },

    stop() {
        running = false;
        void Native.stop();
    }
});
