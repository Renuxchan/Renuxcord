/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Finding { kind: string; sample: string; }

interface Rule { kind: string; re: RegExp; optional?: "ips" | "emails" | "phones"; check?(match: string): boolean; }

function luhn(digits: string) {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = digits.charCodeAt(i) - 48;
        if (double && (d *= 2) > 9) d -= 9;
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
}

const RULES: Rule[] = [
    { kind: "a Discord account token", re: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g },
    { kind: "a Discord MFA token", re: /\bmfa\.[A-Za-z\d_-]{80,}\b/g },
    { kind: "a Roblox login cookie (.ROBLOSECURITY)", re: /_\|WARNING:-DO-NOT-SHARE-THIS\.[^\s]{20,}/g },
    { kind: "an Anthropic API key", re: /\bsk-ant-[A-Za-z\d_-]{20,}/g },
    { kind: "an OpenAI API key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z\d_-]{32,}/g },
    { kind: "a GitHub token", re: /\b(?:gh[pousr]_[A-Za-z\d]{36,}|github_pat_[A-Za-z\d_]{40,})\b/g },
    { kind: "an AWS access key", re: /\b(?:AKIA|ASIA)[A-Z\d]{16}\b/g },
    { kind: "a Google API key", re: /\bAIza[A-Za-z\d_-]{35}\b/g },
    { kind: "a Stripe secret key", re: /\b[rs]k_live_[A-Za-z\d]{20,}\b/g },
    { kind: "a Slack token", re: /\bxox[abprs]-[A-Za-z\d-]{10,}\b/g },
    { kind: "a Discord webhook URL", re: /https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z\d_-]{40,}/g },
    { kind: "a private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
    { kind: "a password", re: /\b(?:password|passwd|pwd|passcode|pass)\s*(?:is|[:=])\s*\S{4,}/gi },
    {
        kind: "a card number", re: /\b(?:\d[ -]?){13,19}\b/g,
        check: m => {
            const digits = m.replace(/\D/g, "");
            return (digits.length === 15 || digits.length === 16) && /^[2-6]/.test(digits) && luhn(digits);
        }
    },
    {
        kind: "an IP address", optional: "ips", re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
        check: ip => !/^(?:127\.|10\.|192\.168\.|0\.|255\.)/.test(ip)
    },
    { kind: "an email address", optional: "emails", re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
    {
        kind: "a phone number", optional: "phones", re: /(?<![\d/#@&])(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}(?![\s-]?\d)/g,
        check: m => {
            const n = m.replace(/\D/g, "").length;
            return n >= 9 && n <= 15;
        }
    }
];

const mask = (s: string) => s.length <= 8 ? "•".repeat(s.length) : `${s.slice(0, 4)}${"•".repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;

export function findSecrets(text: string, include: { ips?: boolean; emails?: boolean; phones?: boolean; } = {}): Finding[] {
    const findings: Finding[] = [];
    for (const rule of RULES) {
        if (rule.optional && !include[rule.optional]) continue;
        for (const match of text.matchAll(rule.re)) {
            const value = match[0];
            if (rule.check && !rule.check(value)) continue;
            findings.push({ kind: rule.kind, sample: mask(value) });
            break;
        }
    }
    return findings;
}
