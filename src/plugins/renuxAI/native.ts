/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Anthropic from "@anthropic-ai/sdk";
import { IpcMainInvokeEvent } from "electron";

export interface AskOptions {
    apiKey?: string;
    model: string;
    effort: "low" | "medium" | "high";
    system: string;
    messages: { role: "user" | "assistant"; content: string; }[];
    maxTokens?: number;
}

export type AskResult = { ok: true; text: string; model: string; } | { ok: false; error: string; };

// Haiku has no server-side refusal fallback
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]);

let cached: { key: string; client: Anthropic; } | null = null;

function getClient(apiKey?: string) {
    const key = apiKey?.trim() ?? "";
    if (cached?.key === key) return cached.client;

    // Without a key the SDK uses ANTHROPIC_API_KEY or an `ant auth login` profile
    const client = new Anthropic({ ...(key ? { apiKey: key } : {}), timeout: 120_000, maxRetries: 2 });
    cached = { key, client };
    return client;
}

export async function ask(_: IpcMainInvokeEvent, opts: AskOptions): Promise<AskResult> {
    try {
        const client = getClient(opts.apiKey);
        const params = {
            model: opts.model,
            max_tokens: opts.maxTokens ?? 16000,
            system: opts.system,
            messages: opts.messages,
            output_config: { effort: opts.effort }
        };

        const res = FALLBACK_MODELS.has(opts.model)
            ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
            : await client.messages.create(params);

        if (res.stop_reason === "refusal") return { ok: false, error: "Claude declined to answer that one." };

        const blocks = res.content as Array<{ type: string; text?: string; }>;
        const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("").trim();
        return { ok: true, text: text || "(empty answer)", model: res.model };
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError)
            return { ok: false, error: "That Anthropic API key isn't valid. Check it in the RenuxAI plugin settings." };
        if (err instanceof Anthropic.RateLimitError)
            return { ok: false, error: "The Claude API is rate limiting you, try again in a moment." };
        if (err instanceof Anthropic.APIError)
            return { ok: false, error: `Claude API error${err.status ? ` ${err.status}` : ""}: ${err.message}` };

        const message = err instanceof Error ? err.message : String(err);
        if (/api.?key|credential|auth/i.test(message))
            return { ok: false, error: "No Anthropic API key found. Paste one into the RenuxAI plugin settings (console.anthropic.com → API keys)." };
        return { ok: false, error: message };
    }
}
