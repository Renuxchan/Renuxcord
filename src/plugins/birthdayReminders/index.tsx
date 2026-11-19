/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { openPrivateChannel } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { dayKey } from "@utils/renuxcordTime";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu, Modal, openModal, TextInput, UserStore, useState } from "@webpack/common";

/** "MM-DD" or "YYYY-MM-DD" */
type Birthday = string;

const settings = definePluginSettings({
    birthdays: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, Birthday>
    },
    notified: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    },
    dayBefore: {
        type: OptionType.BOOLEAN,
        description: "Also give me a heads-up the day before",
        default: true
    }
});

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Accepts "14 March", "mar 14", "14/3" (day first), "2008-03-14" */
export function parseBirthday(input: string): Birthday | null {
    const s = input.trim().toLowerCase();
    let year: number | undefined;
    let month: number | undefined;
    let day: number | undefined;

    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(s))) [day, month, year] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined];
    else {
        const monthIdx = MONTHS.findIndex(name => new RegExp(`\\b${name.slice(0, 3)}`).test(s));
        const nums = s.match(/\d+/g)?.map(Number) ?? [];
        if (monthIdx >= 0) {
            month = monthIdx + 1;
            day = nums.find(n => n >= 1 && n <= 31);
            year = nums.find(n => n > 1900);
        }
    }

    if (!month || !day || month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) return null;
    const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return year && year > 1900 && year <= new Date().getFullYear() ? `${year}-${md}` : md;
}

const monthDay = (b: Birthday) => b.slice(-5);
const yearOf = (b: Birthday) => b.length > 5 ? Number(b.slice(0, 4)) : undefined;

export function prettyBirthday(b: Birthday) {
    const [mm, dd] = monthDay(b).split("-").map(Number);
    const name = MONTHS[mm - 1][0].toUpperCase() + MONTHS[mm - 1].slice(1);
    const year = yearOf(b);
    return `${dd} ${name}${year ? ` ${year}` : ""}`;
}

/** Days until the next birthday (0 = today). Feb 29 birthdays are celebrated on Feb 28 in other years */
function daysUntil(b: Birthday, now = new Date()) {
    const [mm, dd] = monthDay(b).split("-").map(Number);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const at = (year: number) => {
        const leap = new Date(year, 1, 29).getMonth() === 1;
        return new Date(year, mm - 1, mm === 2 && dd === 29 && !leap ? 28 : dd);
    };
    let next = at(today.getFullYear());
    if (next < today) next = at(today.getFullYear() + 1);
    return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

const nameOf = (id: string) => {
    const u = UserStore.getUser(id);
    return u ? u.globalName || u.username : `user ${id}`;
};

function setBirthday(userId: string, b: Birthday | null) {
    const next = { ...settings.store.birthdays };
    if (b) next[userId] = b;
    else delete next[userId];
    settings.store.birthdays = next;
}

function check() {
    const today = dayKey();
    const notified = { ...settings.store.notified };
    let changed = false;

    for (const [id, b] of Object.entries(settings.store.birthdays ?? {})) {
        const left = daysUntil(b);
        const tag = left === 0 ? `day:${today}` : left === 1 ? `eve:${today}` : null;
        if (!tag || (left === 1 && !settings.store.dayBefore) || notified[id] === tag) continue;

        const year = yearOf(b);
        const turning = year ? new Date(Date.now() + left * 86_400_000).getFullYear() - year : undefined;
        showNotification({
            title: left === 0 ? `🎂 It's ${nameOf(id)}'s birthday today!` : `🎈 ${nameOf(id)}'s birthday is tomorrow`,
            body: left === 0 ? `${turning ? `They're turning ${turning}. ` : ""}Click to wish them a happy birthday.` : "Don't forget to wish them tomorrow.",
            onClick: () => openPrivateChannel(id),
            permanent: left === 0
        });
        notified[id] = tag;
        changed = true;
    }
    if (changed) settings.store.notified = notified;
}

function openEditor(user: User) {
    openModal(props => {
        function Editor() {
            const current = settings.store.birthdays?.[user.id];
            const [text, setText] = useState(current ? prettyBirthday(current) : "");
            const parsed = parseBirthday(text);

            return (
                <Modal
                    {...props}
                    title={`🎂 ${user.globalName || user.username}'s birthday`}
                    subtitle="Like 14 March, Mar 14, 14/3 or 2008-03-14. The year is optional"
                    actions={[
                        ...(current ? [{ text: "Remove", variant: "secondary", onClick: () => { setBirthday(user.id, null); props.onClose(); } }] : []),
                        { text: "Save", variant: "primary", disabled: !parsed, onClick: () => { setBirthday(user.id, parsed); props.onClose(); check(); } }
                    ]}
                >
                    <TextInput value={text} onChange={setText} placeholder="14 March" autoFocus />
                    <div style={{ marginTop: 8, color: parsed ? "var(--text-positive, #23a55a)" : "var(--text-muted)" }}>
                        {parsed ? `→ ${prettyBirthday(parsed)} · ${daysUntil(parsed) === 0 ? "that's today!" : `in ${daysUntil(parsed)} days`}` : text ? "I can't read that date yet" : " "}
                    </div>
                </Modal>
            );
        }
        return <Editor />;
    });
}

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.bot) return;
    const b = settings.store.birthdays?.[user.id];
    children.push(
        <Menu.MenuItem
            id="rx-bday"
            label={b ? `🎂 Birthday: ${prettyBirthday(b)} (edit…)` : "Set birthday…"}
            action={() => openEditor(user)}
        />
    );
};

let timer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "BirthdayReminders",
    description: "Never miss a friend's birthday: right-click someone to save it, get a notification on the day (and the day before), and see what's coming up with /birthdays",
    tags: ["Renuxcord", "Friends", "Notifications"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "user-context": userContext,
        "user-profile-actions": userContext
    },

    commands: [{
        name: "birthdays",
        description: "Upcoming birthdays you saved",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            const list = Object.entries(settings.store.birthdays ?? {})
                .map(([id, b]) => ({ id, b, left: daysUntil(b) }))
                .sort((a, z) => a.left - z.left);
            sendBotMessage(ctx.channel.id, {
                content: list.length
                    ? ["🎂 **Upcoming birthdays**", ...list.slice(0, 20).map(({ id, b, left }) =>
                        `${left === 0 ? "🎉 **today**" : left === 1 ? "**tomorrow**" : `in ${left} days`} · **${nameOf(id)}** · ${prettyBirthday(b)}`)].join("\n")
                    : "🎂 No birthdays saved yet. Right-click someone → Set birthday."
            });
        }
    }],

    start() {
        check();
        timer = setInterval(check, 30 * 60_000);
    },

    stop() {
        clearInterval(timer);
    }
});
