# Install Web AI Forge with your coding agent

Send this entire Markdown file to your coding agent, together with the Web AI Forge repository URL or a local checkout path. The agent should carry out the following setup and report the actual result.

1. Locate the repository from the URL or path I provide. If neither is available, ask me for it. Use a dedicated checkout and preserve any existing local changes.
2. Read the repository's README, upstream version manifest, third-party notices, and package scripts. Check that the checkout contains the runnable source and its synthetic demo before installing dependencies. If I supplied only a release draft, report that setup needs the source checkout.
3. Check Git and Node.js 22.12 or later, then run `npm run setup` from the repository root. Report any missing system tools and ask before installing them or changing global settings.
4. Run `npm test`, then start the app with `npm run demo`. Open the loopback URL printed by the process and use the synthetic example for every setup check and screenshot. If the default port is already in use, choose a free one with `npm run demo -- --port 1431`.
5. Verify that the demo renders, an anchored comment can be added, and a suggested edit appears with approval controls. Use the demo fixture for this check. If I ask for a live ChatGPT Web pass, share only the synthetic excerpt and import the reply into its matching review thread. Let me decide whether to accept the proposed edit.
6. Report the local app URL, the command to restart the demo, the versions tested, and which checks passed or need attention.
