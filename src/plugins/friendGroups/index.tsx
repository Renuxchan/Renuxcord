/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MessageDecorationProps } from "@api/MessageDecorations";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Constants, Menu, Modal, openModal, UserStore } from "@webpack/common";
import { patches } from "@webpack/patcher";

import { openGroupEditor } from "./EditGroupModal";
import { GroupsPage } from "./GroupsPage";
import { rowHeight, useSidebarRows } from "./Sidebar";
import { addToGroup, getGroups, groupsOf, removeFromGroup, settings } from "./store";

const SECTION = "RENUX_GROUPS";
const FriendsNavigation = findByPropsLazy("transitionToSection", "setInitialSection");

const Page = ErrorBoundary.wrap(() => <GroupsPage />, { noop: false });

function openGroupsModal() {
    openModal(props => (
        <Modal {...props} size="lg" title="Friend Groups" actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}>
            <GroupsPage inModal />
        </Modal>
    ));
}

/** Opens the Groups tab on the Friends page, or a popup if Discord changed that page */
export function openFriendGroups() {
    // Only the Friends page patch matters here; the sidebar patches have nothing to do with the tab
    const tabMissing = patches.some(p => p.plugin === "FriendGroups" && [p.replacement].flat().some(r => typeof r.replace === "string" && r.replace.includes("renderPage")));
    if (tabMissing) return openGroupsModal();
    try {
        FriendsNavigation.transitionToSection(SECTION);
    } catch {
        openGroupsModal();
    }
}

const ChatIcon = ErrorBoundary.wrap(({ userId }: { userId?: string; }) => {
    if (!userId || !settings.store.chatIcons) return null;
    const groups = groupsOf(userId);
    if (!groups.length) return null;
    return (
        <span className="rx-fg-chat-icon" title={groups.map(g => `${g.icon} ${g.name}`).join("\n")}>
            {groups.map(g => g.icon).join("")}
        </span>
    );
}, { noop: true });

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.bot || user.id === UserStore.getCurrentUser()?.id) return;
    const groups = getGroups();

    children.push(
        <Menu.MenuItem id="rx-fg" label="Friend Groups">
            {groups.map(g => (
                <Menu.MenuCheckboxItem
                    id={`rx-fg-${g.id}`}
                    key={g.id}
                    label={`${g.icon} ${g.name}`}
                    checked={g.members.includes(user.id)}
                    action={() => g.members.includes(user.id) ? removeFromGroup(g.id, user.id) : addToGroup(g.id, user.id)}
                />
            ))}
            {groups.length > 0 && <Menu.MenuSeparator />}
            <Menu.MenuItem id="rx-fg-new" label="New group with them…" action={() => openGroupEditor(undefined, user.id)} />
            <Menu.MenuItem id="rx-fg-open" label="Open Friend Groups" action={openFriendGroups} />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "FriendGroups",
    description: "Put friends into groups with emoji icons and colours, minimize them like folders, drag friends between them. Your groups sit in the DM sidebar (click a friend to open your DM) and in a Groups tab on the Friends page",
    tags: ["Renuxcord", "Friends", "Organisation"],
    authors: [RenuxDevs.Larpbase],
    settings,

    patches: [
        {
            find: "#{intl::FRIENDS_SECTION_ONLINE}),className:",
            group: true,
            replacement: [
                {
                    // The Groups tab, before Pending
                    match: /,\{id:(\i\.\i)\.PENDING,show:.+?className:(\i\.\i)(?=\},\{id:)/,
                    replace: (m, sections, className) => `,{id:${sections}.${SECTION},show:true,className:${className},content:$self.tabLabel()}${m}`
                },
                {
                    // Our page instead of the people list when that tab is open
                    match: /(?<=\i=)(\i)===(\i\.\i)\.ADD_FRIEND\?(?=\(0,\i\.jsx\)\(\i,\{\}\):\(0,\i\.jsx\)\(\i,\{titleId:)/,
                    replace: `$1===$2.${SECTION}?$self.renderPage():$&`
                }
            ]
        },
        {
            // The DM sidebar: Friends, Nitro, Shop, Quests, then the Direct Messages list
            find: '.FRIENDS},"friends"',
            group: true,
            replacement: [
                {
                    // Read the groups with a hook at the top of the component, so it re-renders when they change
                    match: /let{showLibrary:\i,/,
                    replace: "let rxFg=$self.useSidebarRows();$&"
                },
                {
                    // Our rows go right under Quests, above Direct Messages
                    match: /"section-divider-top"\)(?=\])/,
                    replace: "$&,...rxFg.rows"
                },
                {
                    // The list ignores changes to these rows unless one of its other props changes too
                    match: /(?<=listScrollerRef:\i)(?=,children:\[)/,
                    replace: ",rxFgVersion:rxFg.version"
                }
            ]
        },
        {
            // Heights for our rows. Without this they all get Discord's 40px and still work
            find: '"dm-quick-launcher"===',
            replacement: {
                match: /(?<=\.isValidElement\((\i)\)&&\(\i=)\i\.key\?\.startsWith\("section-divider"\)\?\d+:"dm-quick-launcher"===\i\.key\?\d+:\d+/,
                replace: "$self.rowHeight($1)??($&)"
            }
        }
    ],

    tabLabel: () => `📁 ${settings.store.tabName || "Groups"}`,
    renderPage: () => <Page />,
    useSidebarRows,
    rowHeight,

    contextMenus: {
        "user-context": userContext
    },

    renderMessageDecoration: (props: MessageDecorationProps) => <ChatIcon userId={props.message?.author?.id} />,

    toolboxActions: {
        "Open Friend Groups": openFriendGroups,
        "New friend group…": () => openGroupEditor()
    },

    start() {
        Constants.FriendsSections[SECTION] = SECTION;
    }
});
