/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { truncate } from "@utils/renuxcordMessages";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { CommandArgument, CommandOption } from "@vencord/discord-types";

const Native = VencordNative.pluginHelpers.Lookup as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    units: {
        type: OptionType.SELECT,
        description: "Weather units",
        options: [
            { label: "Metric (°C, km/h)", value: "metric", default: true },
            { label: "Imperial (°F, mph)", value: "imperial" }
        ]
    }
});

const STR = ApplicationCommandOptionType.STRING;
const publicOption: CommandOption = { name: "public", description: "Post the answer in chat", type: ApplicationCommandOptionType.BOOLEAN, required: false };

async function get<T = any>(url: string): Promise<{ status: number; data: T; }> {
    const res = await Native.getJson(url);
    if (!res.ok) throw new Error(res.error);
    return { status: res.status, data: res.data as T };
}

async function reply(args: CommandArgument[], channelId: string, job: () => Promise<string>) {
    try {
        const text = await job();
        if (findOption(args, "public", false)) await sendMessage(channelId, { content: text.slice(0, 2000) });
        else sendBotMessage(channelId, { content: text });
    } catch (err) {
        sendBotMessage(channelId, { content: `❌ ${err instanceof Error ? err.message : String(err)}` });
    }
}

// WMO weather codes from Open-Meteo
const WEATHER: Record<number, string> = {
    0: "☀️ Clear", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast", 45: "🌫️ Fog", 48: "🌫️ Icy fog",
    51: "🌦️ Light drizzle", 53: "🌦️ Drizzle", 55: "🌧️ Heavy drizzle", 56: "🌧️ Freezing drizzle", 57: "🌧️ Freezing drizzle",
    61: "🌦️ Light rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain", 66: "🌧️ Freezing rain", 67: "🌧️ Freezing rain",
    71: "🌨️ Light snow", 73: "🌨️ Snow", 75: "❄️ Heavy snow", 77: "🌨️ Snow grains", 80: "🌦️ Showers", 81: "🌧️ Showers", 82: "⛈️ Violent showers",
    85: "🌨️ Snow showers", 86: "❄️ Heavy snow showers", 95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm with hail", 99: "⛈️ Thunderstorm with hail"
};

async function weather(place: string) {
    const geo = await get<{ results?: Array<{ name: string; country?: string; admin1?: string; latitude: number; longitude: number; timezone?: string; }>; }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
    const loc = geo.data.results?.[0];
    if (!loc) throw new Error(`I couldn't find a place called “${place}”.`);

    const imperial = settings.store.units === "imperial";
    const u = imperial ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
    const { data } = await get<any>(
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
        + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day"
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4${u}`);

    const deg = imperial ? "°F" : "°C";
    const speed = imperial ? "mph" : "km/h";
    const c = data.current;
    const where = [loc.name, loc.admin1, loc.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    const days = (data.daily?.time ?? []).slice(1, 4).map((day: string, i: number) => {
        const name = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
        const k = i + 1;
        return `**${name}** ${WEATHER[data.daily.weather_code[k]] ?? "?"} ${Math.round(data.daily.temperature_2m_min[k])}–${Math.round(data.daily.temperature_2m_max[k])}${deg} · 💧${data.daily.precipitation_probability_max[k] ?? 0}%`;
    });

    return [
        `**${where}** · ${new Date().toLocaleTimeString("en-US", { timeZone: data.timezone, hour: "numeric", minute: "2-digit" })} local time`,
        `${WEATHER[c.weather_code] ?? "🌡️"} **${Math.round(c.temperature_2m)}${deg}** (feels like ${Math.round(c.apparent_temperature)}${deg}) · 💨 ${Math.round(c.wind_speed_10m)} ${speed} · 💧 ${c.relative_humidity_2m}% humidity`,
        ...days
    ].join("\n");
}

async function define(word: string) {
    const { status, data } = await get<any>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`);
    if (status === 404 || !Array.isArray(data)) throw new Error(`No dictionary entry for “${word}”. Try /urban for slang.`);
    const entry = data[0];
    const phonetic = entry.phonetic || entry.phonetics?.find((p: any) => p.text)?.text;
    const lines = [`📖 **${entry.word}**${phonetic ? ` ${phonetic}` : ""}`];
    for (const meaning of entry.meanings?.slice(0, 3) ?? []) {
        lines.push(`*${meaning.partOfSpeech}*`);
        for (const [i, d] of (meaning.definitions ?? []).slice(0, 2).entries()) {
            lines.push(`${i + 1}. ${d.definition}${d.example ? `\n   › *${d.example}*` : ""}`);
        }
    }
    return lines.join("\n");
}

async function urban(term: string) {
    const { data } = await get<{ list?: Array<{ word: string; definition: string; example?: string; thumbs_up?: number; permalink?: string; }>; }>(
        `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
    const top = data.list?.sort((a, b) => (b.thumbs_up ?? 0) - (a.thumbs_up ?? 0))[0];
    if (!top) throw new Error(`Urban Dictionary has nothing for “${term}”.`);
    const clean = (s: string) => s.replace(/\[([^\]]+)\]/g, "$1").replace(/\r/g, "");
    return [
        `🏙️ **${top.word}** · 👍 ${top.thumbs_up ?? 0}`,
        truncate(clean(top.definition), 900),
        top.example ? `› *${truncate(clean(top.example), 400).replace(/\n+/g, " ")}*` : ""
    ].filter(Boolean).join("\n");
}

async function wiki(topic: string) {
    const search = await get<[string, string[]]>(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&namespace=0&format=json`);
    const title = search.data?.[1]?.[0];
    if (!title) throw new Error(`Wikipedia has no page for “${topic}”.`);
    const { data } = await get<{ title: string; extract?: string; description?: string; content_urls?: { desktop?: { page?: string; }; }; }>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    return [
        `📚 **${data.title}**${data.description ? ` · *${data.description}*` : ""}`,
        truncate(data.extract ?? "No summary available.", 1200),
        data.content_urls?.desktop?.page ? `<${data.content_urls.desktop.page}>` : ""
    ].filter(Boolean).join("\n");
}

export default definePlugin({
    name: "Lookup",
    description: "Look things up without leaving Discord: /weather anywhere, /define words, /urban for slang and /wiki summaries. No accounts or API keys",
    tags: ["Renuxcord", "Commands", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    commands: [
        {
            name: "weather",
            description: "Current weather and the next 3 days anywhere",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "place", description: "City or town", type: STR, required: true }, publicOption],
            execute: (args, ctx) => void reply(args, ctx.channel.id, () => weather(findOption(args, "place", "")))
        },
        {
            name: "define",
            description: "Dictionary definition of a word",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "word", description: "The word", type: STR, required: true }, publicOption],
            execute: (args, ctx) => void reply(args, ctx.channel.id, () => define(findOption(args, "word", "")))
        },
        {
            name: "urban",
            description: "What does that slang mean? (Urban Dictionary)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "term", description: "The slang", type: STR, required: true }, publicOption],
            execute: (args, ctx) => void reply(args, ctx.channel.id, () => urban(findOption(args, "term", "")))
        },
        {
            name: "wiki",
            description: "Wikipedia summary of anything",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "topic", description: "What to look up", type: STR, required: true }, publicOption],
            execute: (args, ctx) => void reply(args, ctx.channel.id, () => wiki(findOption(args, "topic", "")))
        }
    ]
});
