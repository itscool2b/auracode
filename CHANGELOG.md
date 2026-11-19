# Changelog

Every pull request merged into `main`, newest first, under the day it merged (UTC). Each line is
written in simple English about what changed for the person using auracode: short everyday words,
short sentences, no internal names, and the headline first (owner, 16 November 2026). Each pull
request adds its own line in the same pull request; see "Changelog" in
[docs/developing-in-aura.md](docs/developing-in-aura.md). `node .github/scripts/check-changelog.mjs`
checks the format.

## 2026-11-19

- auracode is getting ready to open its code. The code is now under the MIT license, with a guide for people who want to help and a private way to report security problems. The download page can now list installers for Windows, macOS and Linux with their checksums, and it says plainly when a build is unsigned. ([#144](https://github.com/itscool2b/auracode/pull/144))

## 2026-11-18

- auracode opens on new aircraft pictures. The fifteen text drawings are replaced by ten new pictures, from the Wright Flyer and the P-51 to the 747, the SR-71 and the Space Shuttle. Each one is drawn in your theme's own colours, light or dark, and you still see a different one each start. ([#143](https://github.com/itscool2b/auracode/pull/143))

## 2026-11-17

- New chats no longer break your other chats, and a second project works. Slow work in one folder no longer holds up the rest. When agents are in the way, auracode names the chats and offers to stop them, and at the limit of 16 agents it stops the one idle longest instead of refusing. Terminals open in every project, two projects can set up at once, and a folder you pick stays in the project it belongs to. ([#142](https://github.com/itscool2b/auracode/pull/142))
- The website is redesigned after the Grok Bot page, in light and dark. It opens with the app drawn in its new flat look, then six feature cards, every agent in its own colour, the latest changes as cards, and a full-screen menu on phones. ([#141](https://github.com/itscool2b/auracode/pull/141))
- auracode looks flat, soft and clean, after the Grok Bot app, in every theme. Glass, blur and glow are gone, dark mode uses faint edges instead of shadows, and thin text is a little heavier. New chat starts with the message box, so you type first, every dropdown opens auracode's own menu, and Settings and setup show your agents joining auracode. ([#140](https://github.com/itscool2b/auracode/pull/140))
- Terminals open your own shell, and the keyboard stays where you type. Terminal tabs start your shell with your settings, full colour and your terminal's font, and shortcuts no longer lose your place. The Dashboard drops chats left from earlier days, and any card can be cleared or stopped. On Linux, the browser no longer stops on pages with sound or video, a page that stops can be reloaded, and menus over a page show its picture. ([#139](https://github.com/itscool2b/auracode/pull/139))
- Behind the scenes: the old account service is switched off. With accounts gone from the app, its servers and storage were removed too. The website and remote access are not affected. ([#138](https://github.com/itscool2b/auracode/pull/138))
- auracode no longer has accounts or sync. Claude Code and Codex now sync plugins on their own, so auracode does not need to. There is no sign-in: your chats, projects and settings stay on your computer. Remote access from your phone still works. ([#137](https://github.com/itscool2b/auracode/pull/137))
- Linux is smooth on NVIDIA graphics, and the browser works on Wayland. Scrolling and streaming now hold 60 frames a second where they dropped to about 20. The browser beside the chat opens on Wayland instead of asking for X11, and agents' terminals work when auracode runs as an AppImage. ([#136](https://github.com/itscool2b/auracode/pull/136))

## 2026-11-16

- Choose a chat's model and agent from your phone. On auracode.si/remote, a chat's header now has "Model and agent". The Instructions, Project memory and Remote access pages in Settings share one cleaner look. Updating an agent now waits until its chats stop working, then shows the result. ([#135](https://github.com/itscool2b/auracode/pull/135))

## 2026-11-11

- Behind the scenes: the Mac app builds again. A missing piece needed by dictation had stopped the Mac installer from being made. ([#134](https://github.com/itscool2b/auracode/pull/134))
- Agent updates say what happened, and MCP servers come first. Update now tells you the version it reached, or that nothing changed. Plugins & MCP opens on your MCP servers, with Add server at the top. The browser has its own Settings page, and a bot link can be for chats only or for full control. ([#133](https://github.com/itscool2b/auracode/pull/133))

## 2026-11-10

- Cards look flat, and the Grok Build theme has new colours. Cards in Settings, the Dashboard and chats lose their borders and shadows. The dark Grok Build theme is now dark grey with off-white text. ([#132](https://github.com/itscool2b/auracode/pull/132))
- Remote access stays inside one workspace. A phone or bot link made in one workspace can no longer reach another workspace on the same computer. Opening another workspace ends the first one's remote sessions, and the page says so instead of asking you to pair again. ([#131](https://github.com/itscool2b/auracode/pull/131))
- The desktop app gets a tidier look. Your sent messages stand out more, Search sits at the top of the sidebar, and Attach has its own round button beside Send. A chat that is waiting for you shows a badge in its header. ([#130](https://github.com/itscool2b/auracode/pull/130))
- Settings pages are shorter and clearer. Project memory is now just your notes and one switch. Account & sync shows the four steps to set up syncing, and turning sync on keeps your theme and defaults. ([#129](https://github.com/itscool2b/auracode/pull/129))
- See and steer your computer's chats from your phone. Scan the code in Settings > Remote access, then open auracode.si/remote to read chats, send messages, stop a turn, answer permission requests and start chats. A bot link lets an assistant such as Grok Bot do the same. Everything sent between your phone and your computer is encrypted, and it all stays off until you turn it on. ([#128](https://github.com/itscool2b/auracode/pull/128))
- Project memory sent with a message is now tucked behind one line. The chat used to show the whole memory as part of your message. Now it shows only your words, with "Project memory" underneath to open what the agent received. ([#127](https://github.com/itscool2b/auracode/pull/127))
- The website's changelog now lists every change as it ships. The page is built from the project's own list of changes instead of a note written by hand. ([#126](https://github.com/itscool2b/auracode/pull/126))
- The website has a new design that follows your light or dark setting. It shows the live app window, cards for what the app does, the agents, download links and common questions. ([#125](https://github.com/itscool2b/auracode/pull/125))
- The website is redesigned with a calmer, lighter look. It has a plain header, the live app window at the top, a row of the agents and a grid of the main features. ([#124](https://github.com/itscool2b/auracode/pull/124))
- Several terminal chats can run at once. Before, a second terminal chat was refused while the first was running. Now up to eight can be open across the app. ([#123](https://github.com/itscool2b/auracode/pull/123))

## 2026-11-09

- A long turn shows just its answer when you reopen the chat. Before, a very long turn showed every step. Now its steps fold under "Worked for" like any other finished turn. ([#122](https://github.com/itscool2b/auracode/pull/122))
- Behind the scenes: release builds work again. A change that came with the built-in browser had stopped installers from being built. ([#121](https://github.com/itscool2b/auracode/pull/121))
- A browser now sits beside the chat. Open it with the globe in the chat's header. It has tabs, an address bar, saved passwords and downloads. Agents can open, read and click pages in it but never see your passwords, and Annotate lets you mark part of a page and send a note about it to the agent. ([#120](https://github.com/itscool2b/auracode/pull/120))
- The message box is plainer, and Canvas narration no longer overflows. The coloured ring around the message box is gone. In Canvas, what you say scrolls inside four lines under the drawing, and Finish puts the drawing and your words straight into the message. ([#119](https://github.com/itscool2b/auracode/pull/119))
- OpenCode and Pi now start on Windows. OpenCode installed with npm and Pi installed with its own installer both showed as broken before. They now work in Chat and in Terminal. ([#118](https://github.com/itscool2b/auracode/pull/118))
- The website's home page is redesigned. It has a large headline over the live app window and a new section showing terminal chats and the canvas. The number counters and the fact wheel are gone. ([#117](https://github.com/itscool2b/auracode/pull/117))
- Canvas lets you draw a sketch and add it to your message. Open it beside Attach, then draw with pens, shapes, arrows and text. Press Talk to explain the drawing as you make it. Add to message attaches the drawing and what you said. ([#116](https://github.com/itscool2b/auracode/pull/116))
- Terminal now works for more agents. Grok Build, OpenCode, Hermes, Pi, oh-my-pi, Cursor and Antigravity can open in their own interface inside auracode, as Claude Code and Codex already could. What happens in the terminal comes back into the chat. ([#115](https://github.com/itscool2b/auracode/pull/115))


## 2026-11-07

- auracode opens on a military aircraft drawn in text characters. There are fifteen, and you see a different one each start. Notices now wait behind a bell beside Settings instead of floating over the page. New chat opens only when you ask for it. ([#114](https://github.com/itscool2b/auracode/pull/114))
- Notices moved to the top right, under the header. They fold into one until you point at them, and each has a short title and one line. When an agent update fails, Run in terminal runs it again so you can see its output. ([#113](https://github.com/itscool2b/auracode/pull/113))
- New chat opens on a fighter jet drawn in text characters. There are sixteen, and you see a different one each time auracode starts. It replaces the logo and title. ([#112](https://github.com/itscool2b/auracode/pull/112))
- A chat's access no longer says "Access unavailable" before its first message. A chat opened after a restart shows its access and lets you change it. A new Claude chat that never got a message now starts again after a restart instead of failing. ([#111](https://github.com/itscool2b/auracode/pull/111))

## 2026-11-06

- New chat no longer opens on a long list of folder paths. Folders kept from deleted chats now sit behind one "Retained worktrees" line. It opens by itself only when one of them needs recovery. ([#110](https://github.com/itscool2b/auracode/pull/110))
- A terminal chat counts as Working only while its agent is busy. On the Dashboard, one that is waiting at its prompt sits under Finished as "Open in the terminal". ([#109](https://github.com/itscool2b/auracode/pull/109))
- In a terminal chat, every key now goes to the agent. For example, Shift+Tab changes Claude Code's mode instead of moving around the app. Ctrl+Tab leaves the terminal and Ctrl+Shift+C copies. The Dashboard also fills its space again and keeps its cards in order. ([#108](https://github.com/itscool2b/auracode/pull/108))
- Terminal chats arrive for Claude Code and Codex. A chat can open in the agent's own interface inside auracode, from the chat's header, from New chat, or as the default in Settings. It keeps the chat's account, MCP servers and project memory, and the conversation comes back into the chat when it ends. ([#107](https://github.com/itscool2b/auracode/pull/107))
- Notices now appear at the bottom right, above the message box. Each shows the agent's logo and an Update button. Grok Build and Cursor can now be updated from the app when they were installed with their own installers. ([#106](https://github.com/itscool2b/auracode/pull/106))
- Chats and projects show up again after an update or a restart. Before, the sidebar could stay empty with "database not available". It now fills in as soon as the app's data is ready. ([#105](https://github.com/itscool2b/auracode/pull/105))
- Choose which agents can use each shared MCP server. A server can be for every agent, including ones you install later, or only for the agents you pick. Set this when you add or edit it in Plugins & MCP. ([#104](https://github.com/itscool2b/auracode/pull/104))
- The sea lion and turtle animation is gone. They no longer swim along the message box while an agent works. ([#103](https://github.com/itscool2b/auracode/pull/103))
- A notice tells you when an agent has a newer version. It has an Update button and comes back at each start until you update. Typing while an agent works no longer makes the chat flicker. ([#102](https://github.com/itscool2b/auracode/pull/102))
- Processes is now the Dashboard. It shows every chat as a card in three columns, Needs you, Working and Finished. A card opens its chat and shows what a working agent is doing. ([#101](https://github.com/itscool2b/auracode/pull/101))
- Load earlier now brings back a bigger piece of the chat at once. It keeps loading until 20 more turns appear, and long chats stay light. ([#100](https://github.com/itscool2b/auracode/pull/100))
- The agent list in New chat now opens downward. A long list no longer runs under the title bar and hides its search box. ([#99](https://github.com/itscool2b/auracode/pull/99))
- Behind the scenes: the project plan was updated. It records that the release tools are done and what is left before the first release. ([#98](https://github.com/itscool2b/auracode/pull/98))
- Behind the scenes: releases for Mac, Windows and Linux can now be built automatically. The packages are signed, checked and published, and the download page points to the newest one. It waits only for the signing keys. ([#97](https://github.com/itscool2b/auracode/pull/97))
- Releases now include Linux. The download page lists Linux beside Mac and Windows. Once a signed release is out, auracode on Linux updates itself as it does on the other systems. ([#96](https://github.com/itscool2b/auracode/pull/96))
- Behind the scenes: the website builds and deploys again. A list of third-party notices had gone out of date after an earlier change. ([#95](https://github.com/itscool2b/auracode/pull/95))
- Behind the scenes: the automatic tests catch up with recent changes. They now also check dictation, images and the Processes page in two browser engines. ([#94](https://github.com/itscool2b/auracode/pull/94))
- auracode now runs on Linux. It comes as deb, rpm and AppImage packages. The tray icon, notifications, Keep awake, sounds, dictation and terminals all work, and files open in VS Code, Cursor or Zed. ([#93](https://github.com/itscool2b/auracode/pull/93))

## 2026-11-05

- Share one agent's MCP server with every agent. In Plugins & MCP, choose Preview and copy, then Share with every agent. Its keys stay on this device. Agents that cannot use shared servers now start without them and say so, instead of refusing to start. ([#92](https://github.com/itscool2b/auracode/pull/92))
- Terminals come back after a restart. A chat's terminal panel offers the terminals it had open, and starts them again when you choose Resume. Nothing starts by itself, and earlier output is not kept. ([#91](https://github.com/itscool2b/auracode/pull/91))
- Worktree chats get a Run button. Save a Run command for the folder, then start it from the chat's header and open its address until you press Stop. Each worktree gets local ports of its own, so several can run side by side. ([#90](https://github.com/itscool2b/auracode/pull/90))
- File names in a chat open in your editor at the right line. This works for paths in an agent's answers, in a step's files, in the changed-files card and in Changes. Choose the editor in Settings > Chats. ([#89](https://github.com/itscool2b/auracode/pull/89))
- A new setting plays a sound when a chat needs you. You hear a short, quiet tone when a chat finishes, fails or needs you, even while auracode is in front. It is in Settings > General and is off by default. ([#88](https://github.com/itscool2b/auracode/pull/88))
- Search inside a chat with Ctrl+F (Cmd+F on Mac). A bar counts and highlights every match in your messages and the agent's answers. Step through them with Enter and Shift+Enter. ([#87](https://github.com/itscool2b/auracode/pull/87))
- Commit and push your changes from inside auracode. In the Git workspace dialog, pick the changed files, write a message and review the commit before it is made. Then push the branch. ([#86](https://github.com/itscool2b/auracode/pull/86))
- Changes folds long files and can undo a single change. Each change shows with three lines around it and the rest folded. Revert above a change puts back just those lines. ([#85](https://github.com/itscool2b/auracode/pull/85))
- Comment on lines in Changes and send the comments to the agent. All your comments go as one message that quotes each line. You can also ask the agent to review the changes and report problems before it edits anything. ([#84](https://github.com/itscool2b/auracode/pull/84))
- More agents show a command's output as it runs. Where a chat said "terminal output is not available", you now see the output as it comes and how the command ended. ([#83](https://github.com/itscool2b/auracode/pull/83))
- MCP server forms now show in Claude and Codex chats. Forms and browser steps that MCP servers ask for used to be cancelled. The Session tab also lists what the session loaded, such as MCP servers, skills, plugins and subagents. ([#82](https://github.com/itscool2b/auracode/pull/82))
- Fork keeps the agent's memory, and Rewind restores your files. Fork into a new chat from the latest answer continues Claude's or Pi's own session, with everything it knew. Rewind on a sent message puts files back to how they were before it, then lets you edit the message. You can also steer Pi while it works. ([#81](https://github.com/itscool2b/auracode/pull/81))
- Answers now show coloured code, maths and diagrams. Code uses the theme's colours, maths is set out properly, and Mermaid diagrams are drawn, with their source a click away. ([#80](https://github.com/itscool2b/auracode/pull/80))
- Agent steps show more detail. An opened tool call shows what it was given, a web search lists the pages it found as links, and an edit counts its changed lines. Claude's to-do list shows as a checklist, and the chat's menu has Compact conversation. ([#79](https://github.com/itscool2b/auracode/pull/79))
- Settings is now one screen with a search box. The search finds any setting. Chats can keep the steps of finished turns open, and Voice can test your microphone. ([#78](https://github.com/itscool2b/auracode/pull/78))
- Dictation is built in and has no time limit. It runs on your device. Words appear at the cursor as you speak, Finish adds them to your message and Cancel removes them. ([#77](https://github.com/itscool2b/auracode/pull/77))
- A finished turn folds its work under one line. The line reads like "Worked for 1 min 42 s · 12 steps" and sits above the final answer. A card under the answer names the files that changed. ([#76](https://github.com/itscool2b/auracode/pull/76))
- More of a chat fits on screen. Text is a little smaller and answers use the full width. Choose the Comfortable text size in Settings to get the earlier size back. ([#75](https://github.com/itscool2b/auracode/pull/75))
- Claude Code's theme is now the default look. This applies only if you never chose a theme. A theme you picked, Aura included, is kept. ([#74](https://github.com/itscool2b/auracode/pull/74))
- The controls around the message box are quieter. Only Send is filled in. Your account shows as its initial with a ring for its usage, and the picker lists models, thinking levels, then every agent. ([#73](https://github.com/itscool2b/auracode/pull/73))

## 2026-11-04

- Settings offers a theme for every supported agent. There is one each for Claude Code, Codex, Grok Build, Pi, Antigravity, Cursor, OpenCode, oh-my-pi and Hermes, beside Aura. Each comes in light and dark and applies at once. ([#72](https://github.com/itscool2b/auracode/pull/72))
- Grok Build and Hermes now show their plugins and marketplaces. Claude Code marketplaces show where they come from again. You can add a marketplace from a GitHub repository, a Git address or a local folder. ([#71](https://github.com/itscool2b/auracode/pull/71))
- See everything your agents are running. A new Processes page lists each chat's subagents, background commands and programs, with a Stop button. Stop in a chat now says it also ends running tasks. ([#70](https://github.com/itscool2b/auracode/pull/70))
- This changelog is added. Every merged change adds a line to it, and an automatic check keeps its format right. ([#69](https://github.com/itscool2b/auracode/pull/69))
- Dictation now records on Windows. Before, small audio glitches ended every recording after a tenth of a second. Turning speech into text is also much faster, under a second for 11 seconds of speech instead of 18. ([#68](https://github.com/itscool2b/auracode/pull/68))

## 2026-11-03

- The website gets design polish. Headings have new italic accents, and the two scrolling rows now loop without a gap. ([#67](https://github.com/itscool2b/auracode/pull/67))
- The working line shows the model maker's logo. While an agent works, you see the logo of the company whose model is doing the work. ([#66](https://github.com/itscool2b/auracode/pull/66))
- Subagents and background commands appear above the message box. Click one to open a panel that follows its progress. ([#65](https://github.com/itscool2b/auracode/pull/65))
- The website loses its coloured glows. The depth they gave is made in other ways. ([#64](https://github.com/itscool2b/auracode/pull/64))
- Switch a Claude Code chat's account from the message box. You can also see how much each account has used, and read a plan before the agent runs it. The app's glow effects are gone. ([#63](https://github.com/itscool2b/auracode/pull/63))

## 2026-11-02

- Behind the scenes: installing a locally built copy of the app on Windows is safer. If the new copy fails to start, the previous app comes back. More of the app is also tested automatically. ([#62](https://github.com/itscool2b/auracode/pull/62))
- Image attachments show small previews. You see them before sending and in the chat's history, and can open one to see it larger. ([#61](https://github.com/itscool2b/auracode/pull/61))
- Dictation in the message box works offline. It needs a one-time download first, which is checked before use. ([#60](https://github.com/itscool2b/auracode/pull/60))
- Newly installed agents are found without restarting auracode. This also covers Cursor's own install on Windows. ([#59](https://github.com/itscool2b/auracode/pull/59))
- Links in Settings open the right Customize page. Plugins & MCP, Instructions and Project memory open in Customize, and your chat and draft stay as they were. ([#58](https://github.com/itscool2b/auracode/pull/58))
- Questions and permission requests appear one at a time. They show in the order they arrived, with a count of how many are left. ([#57](https://github.com/itscool2b/auracode/pull/57))
- A working turn shows one line with the time so far. Tool details also open more smoothly. ([#56](https://github.com/itscool2b/auracode/pull/56))
- The model picker switches models reliably. It also keeps the thinking level in view. ([#55](https://github.com/itscool2b/auracode/pull/55))
- Agents can now edit project memory directly. A switch in Customize > Project memory turns this off, so that their edits wait for your review instead. ([#54](https://github.com/itscool2b/auracode/pull/54))

## 2026-11-01

- A Claude chat that hits its usage limit can switch accounts. It carries on with another account you added, and keeps its history. ([#53](https://github.com/itscool2b/auracode/pull/53))
- Behind the scenes: the developer guide records a tested upgrade of the installed app. ([#52](https://github.com/itscool2b/auracode/pull/52))
- Behind the scenes: installing a locally built copy of the app now checks that the new version is really in place. Before, it could report success while the old version was still there. ([#51](https://github.com/itscool2b/auracode/pull/51))
- Behind the scenes: undoing a local test install on Windows now puts back the original files themselves. Windows could refuse to start a copy of them. ([#50](https://github.com/itscool2b/auracode/pull/50))
- Behind the scenes: the list of third-party notices was refreshed, so the app and the website build again. ([#49](https://github.com/itscool2b/auracode/pull/49))
- Behind the scenes: auracode can be developed safely from inside auracode. Test builds keep their own data and run separately, so they never touch your installed app. ([#48](https://github.com/itscool2b/auracode/pull/48))
- New worktree chats get the folder's private instruction files. Instruction files that Git ignores used to be missing there, so agents ran without them. This is on by default and can be turned off. ([#47](https://github.com/itscool2b/auracode/pull/47))
- The website and the desktop app get a new look called Halo. Windows look like glass over your system's own window background. ([#46](https://github.com/itscool2b/auracode/pull/46))
- Shared MCP servers and project memory arrive, with new chat controls. Access and Plan controls sit beside a searchable picker for agent, model and effort. Customize holds Plugins & MCP, instructions and project memory. ([#45](https://github.com/itscool2b/auracode/pull/45))

## 2026-10-31

- Automatic checkpoints are now off unless you turn them on. Ordinary messages send without the delay of saving a snapshot of your files first. Checkpoints saved earlier stay available. ([#44](https://github.com/itscool2b/auracode/pull/44))
- Messages reach the agent faster when checkpoints are on. Saving a checkpoint of your files before each message takes far less time. ([#43](https://github.com/itscool2b/auracode/pull/43))

## 2026-10-30

- The website and the desktop app share one new look, called Aura. The desktop app follows your system's light or dark setting, and you can choose Light or Dark yourself. ([#42](https://github.com/itscool2b/auracode/pull/42))
- An interrupted clone can be recovered safely. If copying a repository is cut short, auracode remembers it and offers to open the folder or try again in another folder. ([#41](https://github.com/itscool2b/auracode/pull/41))
- Interrupted changes to Instructions recover safely. Edits you made to those files outside auracode are not lost. ([#40](https://github.com/itscool2b/auracode/pull/40))
- The Plugin library fills in one agent at a time. You see results sooner, and the row menus stay where they are. ([#39](https://github.com/itscool2b/auracode/pull/39))
- You can write messages while a new worktree is being set up. They wait in a queue and send when the setup is done. ([#38](https://github.com/itscool2b/auracode/pull/38))
- Revert is safer. Before it changes your project, auracode saves checked copies of the original files so they can be recovered. ([#37](https://github.com/itscool2b/auracode/pull/37))
- Cleaning up saved sign-ins removes only auracode's own entries. Running two copies of the app at the same time is also safer. ([#36](https://github.com/itscool2b/auracode/pull/36))
- Sent messages are tracked more reliably. A message being sent is no longer mixed up with another, and held messages keep their order. ([#35](https://github.com/itscool2b/auracode/pull/35))
- Sending, queues and recovery are more reliable. You can write during setup, held messages keep their order, interrupted work recovers safely, and the Plugin library fills in step by step. ([#34](https://github.com/itscool2b/auracode/pull/34))

## 2026-10-28

- Fixes for Windows. The terminal panel now works, the title bar matches the app, and choosing a project in New chat no longer changes the agent you picked. Names and setup messages are clearer too. ([#33](https://github.com/itscool2b/auracode/pull/33))
- A queued message now says why it is waiting. It also no longer waits forever when an agent fails to report that it has finished. ([#32](https://github.com/itscool2b/auracode/pull/32))
- The Claude, Grok, Antigravity and Hermes logos are added. Every supported agent now shows its real logo in the app and on the website. ([#31](https://github.com/itscool2b/auracode/pull/31))
- Codex, Cursor, OpenCode, Pi and oh-my-pi show their real logos. You see them in the app and on the website, where they also move. ([#30](https://github.com/itscool2b/auracode/pull/30))
- An agent's opened details on the Agents page line up neatly. This is a small layout fix, with a new automatic check for it. ([#29](https://github.com/itscool2b/auracode/pull/29))
- Follow-ups to the water design. The website shows today's app, the Agents and Plugin library pages sit in the same panel as chat, and the swimming animals use far less of your computer's power. The old dotted background is removed. ([#28](https://github.com/itscool2b/auracode/pull/28))
- Each agent now appears once in the list. Before, some had a second entry for another way of connecting. That choice is now a Connection setting on the Agents page, and it is automatic by default. ([#27](https://github.com/itscool2b/auracode/pull/27))
- Uninstalling auracode removes all of its own data. Settings can do the same. Your coding agents are left alone. ([#26](https://github.com/itscool2b/auracode/pull/26))
- The app gets the water design. The chat sits in a rounded panel, the opening screens show lit water with a seal and a turtle, and small spaces have gentle motion. ([#25](https://github.com/itscool2b/auracode/pull/25))
- A new Instructions page manages what your agents are told. Use one shared file for every agent, or a file per agent. You review every change before it is saved. ([#24](https://github.com/itscool2b/auracode/pull/24))
- The Plugin library has a section for each agent. It lists what each agent itself reports, shows whether an update is available, and syncs agent by agent. ([#23](https://github.com/itscool2b/auracode/pull/23))
- The website is rebuilt with a lit water design. Seals and turtles swim in the top panel beside the real app. ([#22](https://github.com/itscool2b/auracode/pull/22))
- Fixes from testing on Windows. Changes made just before quitting are no longer lost. The foot of the sidebar is now only the logo and a Settings button. ([#21](https://github.com/itscool2b/auracode/pull/21))
- Clone a repository from inside auracode. It is offered when you first set up and in New project. Making an account is an optional step, and more agents can be installed and signed in to from the app. ([#20](https://github.com/itscool2b/auracode/pull/20))
- Behind the scenes: account tests no longer trip over each other, and the project notes were updated. ([#19](https://github.com/itscool2b/auracode/pull/19))
- Fixes found by testing the app on Windows. Among them, the first message in a worktree chat is no longer held back, and changed lines show in the right order. ([#18](https://github.com/itscool2b/auracode/pull/18))
- A terminal panel sits at the bottom of each chat. There is also help with merge conflicts, where you can ask the agent to resolve them or open the folder in your editor. More editors are supported, such as Zed and the JetBrains ones. ([#17](https://github.com/itscool2b/auracode/pull/17))
- Small gaps are closed across chats and Settings. You can edit and reorder queued messages, open the first nine chats with Ctrl or Cmd plus a number, and set a default agent and model. Settings adds switches for notifications, Keep awake and running in the tray. ([#16](https://github.com/itscool2b/auracode/pull/16))
- New chats get their own worktree automatically. A worktree is a separate copy of the project, so chats do not get in each other's way. You can still switch a chat to Local or change its branch before you create it. ([#15](https://github.com/itscool2b/auracode/pull/15))
- Behind the scenes: groundwork for chats in their own worktree. The app can now create a chat in a separate copy of the project and recreate a deleted copy. The buttons for it come in a later change. ([#14](https://github.com/itscool2b/auracode/pull/14))
- Every screen of the app is redesigned. The sidebar, header, chat and account row all have a cleaner look. ([#13](https://github.com/itscool2b/auracode/pull/13))
- OpenCode can be installed with one click on the Agents page. ([#12](https://github.com/itscool2b/auracode/pull/12))
- Behind the scenes: the desktop app's buttons, fields and dialogs now share one style. This prepares for the redesign of each screen. ([#11](https://github.com/itscool2b/auracode/pull/11))
- Behind the scenes: a new tool publishes releases safely. It checks every file again before uploading and never overwrites a published file. ([#10](https://github.com/itscool2b/auracode/pull/10))
- Behind the scenes: new tests for the search behind the command palette. ([#9](https://github.com/itscool2b/auracode/pull/9))
- The website is rebuilt with a simpler home page. It goes from eight sections to five. Nothing in the app changes. ([#8](https://github.com/itscool2b/auracode/pull/8))

## 2026-10-27

- The seal and turtle logo is now used everywhere. It replaces the old pixel letter in the app, on the website and in every icon. ([#7](https://github.com/itscool2b/auracode/pull/7))
- The app and the website get a dark look called Graphite. It is black with one lime accent colour. This change also adds the view that shows a chat's conversation. ([#6](https://github.com/itscool2b/auracode/pull/6))
- Behind the scenes: the project's technical foundation and rules are set. Nothing in the app changes. ([#4](https://github.com/itscool2b/auracode/pull/4))

## 2026-10-26

- Behind the scenes: two unreliable tests on Mac and Linux are fixed. The app itself is unchanged. ([#3](https://github.com/itscool2b/auracode/pull/3))
- The first real agent chats work. auracode can now run Hermes, Claude Code and Codex in one chat window. ([#2](https://github.com/itscool2b/auracode/pull/2))
- Behind the scenes: the project is started. It has the basic app window, safe storage on your device and automatic checks. ([#1](https://github.com/itscool2b/auracode/pull/1))
