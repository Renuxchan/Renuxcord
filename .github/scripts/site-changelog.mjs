/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Writes the newest Renuxcord changes for the site's changelog: the main line only, so upstream merges and their commits stay out

import { execFileSync } from "child_process";
import { writeFileSync } from "fs";

const out = process.argv[2] ?? "site/changelog.json";
const SEP = "\u001f";

// Only the repository owner's own commits: further back, main's history is the upstream project's
const owner = process.env.GITHUB_REPOSITORY_OWNER || "Renuxchan";
const log = execFileSync("git", ["log", "--first-parent", "--no-merges", "-n", "60", `--author=${owner}`, `--format=%H${SEP}%aI${SEP}%s`], { encoding: "utf8" });

const changes = log
    .split("\n")
    .filter(Boolean)
    .map(line => {
        const [hash, date, message] = line.split(SEP);
        return { hash, date, message };
    })
    .filter(c => !/^Merge /.test(c.message))
    .slice(0, 12);

writeFileSync(out, JSON.stringify(changes, null, 4) + "\n");
console.log(`Wrote ${changes.length} changes to ${out}`);
