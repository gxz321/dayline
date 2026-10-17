# Dayline opportunity radar and unattended updater

The original public Sites project and planner remain in place. Do not change the audience to make updates work. Browser-only personal planning edits are never sent to this updater.

## Verified state, 2026-10-11

Public version 2 is deployed and the browser retrieved 66 real signals with 8 of 10 sources healthy. LangGraph returned HTTP 403; EIA timed out. These are observed results for that run. Direct CLI GET requests received a platform 403. The formal Sites MCP integration is in progress; hosted tool connection and unattended refresh/readback have not been verified. The intended four-hour cloud cadence has not been created or verified active.

## Data and public cache

worker/radar-core.mjs collects the fixed primary-source registry in src/data/radar-sources.json: AWS, NVIDIA, China's NDRC, Schneider, Microsoft, CISA, arXiv, Europe PMC, LangGraph and EIA. Only configured HTTPS URLs and redirect hosts can be requested. No paywalled crawling, external AI API key, paid LLM inference, personal query or arbitrary upload is supported.

GET /api/radar reads a shared R2 snapshot. If older than one hour, one collector is admitted through an R2 conditional lease. An existing stale snapshot returns immediately while a bounded background refresh runs. GET /api/radar?wait=1 waits for that same update. Other API methods and query parameters are rejected. The read path only maintains a derived public cache from the fixed catalog; clients cannot write records, choose URLs or keys, or submit planner data. Missing storage returns an explicit unavailable response. The GET service remains the browser API and a supported HTTP fallback; the official Sites MCP tools are the preferred unattended channel.

The collector uses three concurrent fetches, 8.5-second per-source timeouts (NVIDIA 12 seconds), a 23-second global deadline, and per-source streaming body caps from 200 KB to 3 MB. Every redirect is checked. DTD/external entities are rejected. Source order rotates hourly for fairness. Failed attempts retain a one-hour cooldown. Failed sources retain relevant old entries and their actual last-success time; successful empty sources replace their previous results. Future dates are excluded; missing years never become today's date. Known items older than 90 days are removed. CVE/arXiv versions, canonical URLs and exact normalized titles are deduplicated. IDs normally follow canonical URLs and survive headline changes. The heuristic cannot recognize all syndicated stories or infer true independent business evidence.

The rules score reading/verification priority, never income or return probability: recency 30, source evidence 25, independent publishing organizations 25, manually set entry convenience 20. Source type, publication/collection dates, unknown dates and failure states remain visible. Keywords can misclassify or miss a topic; inspect the original source. Supplier announcements and research are not purchase orders. Signals feed one bounded 30-day customer experiment, not automatic new schedule commitments.

The frontend reads while visible every five minutes; it supports 20-at-a-time reading, search/topic filters, favorites, hiding/undo, source health and an independent verified local radar cache. Favorites/hidden IDs are included in version-1 planner backups. No personal name, GPA or asset data is needed for the algorithm.

## Official Sites MCP channel

worker/mcp.mjs implements POST /mcp with two parameter-free tools: read_radar and refresh_radar. Both reuse the existing in-process radar handler and shared R2 cache; the API and frontend behavior stay in place. They do not read personal schedules, budgets, favorites or completion records, and accept no source URL, force flag or other arguments.

read_radar reads the shared snapshot with the existing automatic cache rules. refresh_radar waits for the existing collector subject to its one-hour cooldown. Refresh requires authenticated login identity injected by Sites. A service-access token alone does not establish that identity. Invoke the Site-generated plugin tool through the platform connection; never fabricate an identity header or imitate login with a manually constructed request. The local adapter is implemented and tested; this does not confirm installation, connection or a successful hosted invocation.

## Build

The package build runs Vite and scripts/build-worker.mjs, which embeds client assets with the Worker into dist/server/index.js. Source .openai/hosting.json retains the project ID, removes static, and declares R2 binding BUCKET. Credentials are never embedded. The local preview executes the generated Worker with a disk-backed R2-compatible adapter; local and hosted caches are separate.

## Fresh cloud-task instructions

Use the Site linked to the cloud task. Obtain its published URL and current state with get_site, then discover the tools from that Site's automatically generated plugin. Prefer its actual refresh_radar tool with empty arguments, followed by its read_radar tool with empty arguments. Verify the persisted lastAttemptAt/generatedAt, nextRefreshAt, status and individual source states against the refresh result. Routine updates use the deployed collector and shared cache; no source change or republication is required. Respect the one-hour cooldown; an already-fresh result is a valid no-op. meta.refreshing means collection is still pending, and generatedAt advances only when new valid source data was obtained.

If these tools are missing, complete the official Install/Connect flow and discover them again. Until connection and refresh/readback succeed, report the channel as unverified. Do not claim that a saved task, local tests, a published UI or a queued refresh proves unattended success. Do not create a duplicate recurring task to work around missing tools.

The GET service is a fallback only when supported platform access works. If supported service access is needed, get_site may return a token accepted only by that Site in the OAI-Sites-Authorization: Bearer header. Keep it in session memory; never put it in source, prompts, files, logs or URLs. This token does not confer login identity or connected-app consent. If HTTP access receives platform 403, stop that route and use the official Install/Connect channel. Do not weaken access policy, spoof browser identity or bypass security gates.

The default cloud cadence is every four hours in Asia/Shanghai. Current task creation and enabled state are authoritative only in get_site automations; this file does not create or activate a task. Read linked automations first, reuse matching schedules and preserve paused state unless the owner asks to resume. Verify tool connection and the unattended channel before describing the schedule as operational. Keep routine updates quiet; report a meaningful new actionable signal or repeated update failure. Distinguish task saved, collector invoked, and persisted readback verified. Report partial source failures accurately. Never invent news or a successful refresh when network/source access failed.
