# keycard-mcp-demo

A learning project: a small TypeScript MCP server protected by [Keycard](https://keycard.ai), which calls the GitHub API **as the signed-in user** (delegated access via OAuth token exchange).

It follows two Keycard guides:

1. [Add Auth to Custom MCP](https://docs.keycard.ai/guides/mcp-server/) (Part 1)
2. [Call External APIs from MCP](https://docs.keycard.ai/guides/delegated-access/) (Part 2)

## What the server does

| Tool | Part | What it does |
| --- | --- | --- |
| `hello_world(name)` | 1 | Returns a greeting. Proves sign-in and bearer-token verification work. |
| `whoami_github` | 2 | Calls `GET /user` on GitHub with **your** GitHub token and returns your login. |
| `list_my_repos` | 2 | Calls `GET /user/repos?visibility=public&per_page=5` and returns your 5 most recently updated **public** repos. |

> The server never stores a GitHub token or a shared API key. Keycard holds the per-user GitHub grant, refreshes it, and hands the server a short-lived token for the current user on each request.

## How it works

1. **Cursor calls the server with no token.** It sends `POST /mcp` and the server answers `401 Unauthorized`. The response points Cursor at the server's `/.well-known/*` pages, which are served by `mcpAuthMetadataRouter`.
2. **Cursor finds the Keycard zone.** The `.well-known` pages say "sign-in happens at this Keycard zone" (the `KEYCARD_ZONE_URL` you configured).
3. **You sign in to Keycard.** Cursor opens a browser window and you log in as a zone user. Keycard issues Cursor an access token that is only valid for this server (its audience is `http://localhost:8080/mcp`).
4. **Cursor retries with the token.** It sends `POST /mcp` with the token in an `Authorization: Bearer ...` header.
5. **The server checks the token.** `requireBearerAuth` rejects it if it came from any issuer other than your zone, or if it was minted for a different resource. If it passes, the request continues.
6. **The server trades your token for a GitHub token (Part 2).** `authProvider.grant("https://api.github.com")` sends your Keycard token, plus the Application's client ID and secret, back to Keycard. Keycard returns a GitHub access token that belongs to you. The first time, Keycard sends you through GitHub's consent screen. After that, Keycard stores and refreshes the GitHub grant for you.
7. **The server runs the tool you asked for.** If you asked for `whoami_github`, the server calls GitHub's `GET /user` with your GitHub token and sends your profile back to Cursor. If you asked for `hello_world`, it just returns the greeting and never calls GitHub.

   Under the hood, the server keeps no state between requests: it creates a new MCP server object for each request and discards it afterward. That is why your GitHub token stays tied to your request and can't be seen by another user's request.

If step 6 fails (for example, you haven't completed GitHub consent), the server does not reject the request. It records the error, so `hello_world` still works and the GitHub tools return a message explaining what went wrong.

## Prerequisites

- **Node.js 22 or newer** (current LTS is best). Check with `node -v`.
- A [Keycard](https://keycard.ai) account with access to Console.
- A GitHub account (Part 2).
- Cursor (or another MCP client that supports OAuth) for testing.

## Project layout

```text
.
├── src/server.ts        # Whole server: auth, token exchange, tools
├── .cursor/mcp.json     # Registers this server in Cursor
├── .env.example         # Env vars (copy to .env)
├── tsconfig.json
└── package.json
```

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `KEYCARD_ZONE_URL` | Yes | Issuer URL from Console, Settings, Connection. |
| `PORT` | No (default `8080`) | Port to listen on. Resource Identifier in Console must be `http://localhost:<PORT>/mcp`. |
| `KEYCARD_CLIENT_ID` | Part 2 | Application client ID. Blank = Part 1 only. |
| `KEYCARD_CLIENT_SECRET` | Part 2 | Application client secret. Never commit it. |
| `GITHUB_RESOURCE` | No (default `https://api.github.com`) | Identifier of the GitHub resource in Console. |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm start` | Run the server (loads `.env`). |
| `pnpm dev` | Run with auto-restart on file changes. |
| `pnpm typecheck` | Type-check with `tsc`. |

## Setup

```bash
git clone https://github.com/jpvajda/keycard-mcp-demo.git
cd keycard-mcp-demo
pnpm install
cp .env.example .env
```

This project uses **pnpm** (see `packageManager` in `package.json`). `pnpm install` prints an "Ignored build scripts: esbuild" warning; it is safe to ignore because `tsx` works without esbuild's postinstall script.

### Part 1: Register the server as a Resource in Keycard Console

[Console](https://console.keycard.ai/) >  Resources > Add Resource >  Add Manually:

| Field | Value |
| --- | --- |
| Resource Name | `Keycard MCP Demo (Local Dev)` |
| Resource Identifier | `http://localhost:8080/mcp` |
| Credential Provider | `Zone Provider` |
| MCP Server toggle | On |

The Resource Identifier must match the URL your server is reachable at, exactly. If you change `PORT` in `.env`, change it here too. Why this matters: the identifier becomes the `aud` (audience) claim in the tokens Keycard issues for your server, and `requireBearerAuth` checks that claim. "Zone Provider" means Keycard itself signs the token for this Resource.

**2. Let yourself sign in**

Nothing to configure. Per the [Zone Authentication](https://docs.keycard.ai/admin/zone-authentication/) docs, zone sign-up happens in-band: when you connect to the MCP server in step 5, Keycard prompts you to log in or sign up on the spot, then to verify your email. You don't create the user in the Console first, and this zone user is separate from your Console login. The only related setting is the zone's Identity Provider (Zones, ⋯ menu, Settings, Zone sign in configuration), which should stay on Keycard's built-in default.

**3. Fill in `.env`**

Console > Settings >  Connection >  copy the **Issuer URL**:

```bash
KEYCARD_ZONE_URL=https://<your-zone-id>.keycard.cloud
PORT=8080
```

Leave `KEYCARD_CLIENT_ID` and `KEYCARD_CLIENT_SECRET` blank for now.

**4. Run & Validate**

```bash
pnpm start
```

Expected output:

```bash
Keycard MCP demo listening on http://localhost:8080/mcp
  Zone:             https://<your-zone-id>.keycard.cloud
  Delegated access: OFF (set KEYCARD_CLIENT_ID/SECRET for GitHub tools)
```

Do a quick check without a client (should return a `401` with a `WWW-Authenticate` header):

In a terminal run:

```bash
curl -i -X POST http://localhost:8080/mcp -H 'content-type: application/json' -d '{}'
```

**5. Connect Cursor**

This repo includes [`.cursor/mcp.json`](.cursor/mcp.json):

```json
{
  "mcpServers": {
    "keycard-mcp-demo": { "url": "http://localhost:8080/mcp" }
  }
}
```

1. Open this project folder in Cursor. Cursor reads `.cursor/mcp.json` when the window opens.
2. Open Cursor Settings (`Cmd+Shift+J` on Mac, `Ctrl+Shift+J` on Windows and Linux) and click **Tools & MCP** in the left nav.
3. Find **keycard-mcp-demo** in the list. If it isn't there, click the refresh control at the top of the list.
4. Turn the server's toggle on, then click **Connect** (it may be labeled **Needs login**). Your browser opens the Keycard zone sign-in. Click **Sign up** the first time, then verify your email.
5. Back in Cursor, expand the server entry. It lists the tools `hello_world`, `whoami_github`, and `list_my_repos`.

**6. Test**

Ask the agent: `Run the hello_world tool with my name using the keycard-mcp-demo.`.

**7. Verify in Console**

Console, Audit Log should show `users:authenticate`, `users:authorize`, and `credentials:issue`.

### Part 2: Delegated access to GitHub (about 30 to 45 minutes)

**1. Copy the Keycard Redirect URL**

Console > Settings > Connection > copy **Redirect URL**.

**2. Create a GitHub OAuth App**

GitHub >Settings > Developer settings > OAuth Apps > New OAuth App:

- Homepage URL: any valid URL. GitHub requires one but only displays it on the consent screen; nothing in this demo links to it. Use `https://github.com/jpvajda/keycard-mcp-demo` or `http://localhost:8080`.
- Authorization callback URL: the Keycard Redirect URL from step 1
- Leave the checkboxes at their defaults: **Expire user access tokens** checked, **Allow wildcard matching** and **Enable Device Flow** unchecked. The checked one makes GitHub issue a refresh token, which is what lets Keycard renew your access automatically. The other two are for callback wildcards and browserless device login, which this demo doesn't use.

Save, then click **Generate a new client secret**. Copy the Client ID and Client Secret somewhere temporary. You'll paste both into Keycard in the next step, and GitHub shows the secret only once. These are not the credentials that go in `.env`. Those come from the Keycard Application in step 4.

**3. Add GitHub to Keycard**

Console > Resources > Add Resource > Explore Resources > pick **GitHub API** (not **GitHub MCP**).

GitHub API is the resource this server calls directly with the exchanged token. GitHub MCP is GitHub's hosted MCP server, which would replace your code instead of teaching the token exchange. Paste the Client ID and Client Secret, and note the resource identifier shown (normally `https://api.github.com`).

On the resource's scopes section, the Available scopes list will be empty ("No scopes discovered from resource metadata"), so type them into **Active scopes** and click **Add scope** for each: `read:user` (profile for `whoami_github`) and `public_repo` (public repos for `list_my_repos`).

**4. Create a Keycard Application**

Console > Applications > Add Application > On the form:

- Name: `Keycard MCP Demo App`
- Identifier: `https://github.com/jpvajda/keycard-mcp-demo` (must be unique in the zone; it becomes the `keycard_app_id` claim in issued tokens, and nothing connects to it)
- Leave **Proxy MCP Tools** off. Turning it on makes this Application a gateway instead of a token-exchange app.
- Leave **Consent** on **Required**, so users are prompted before GitHub access is granted.
- Leave Documentation URL, Redirect URLs, and Description blank. Cursor handles its own sign-in, so no redirect is needed.

Then on its detail page:

- **Provides** tab: Add provided resource >  select your MCP server Resource.
- **Dependencies** tab: Add dependency > select the GitHub API resource.
- Generate client credentials. Open the **Application Credentials** tab, click **Add Credential**, and choose **Client ID & Secret**. Copy both values immediately. The secret is shown only once. These go in `.env` in the next step, and they're a different pair from the GitHub OAuth App credentials, which stay on the GitHub resource.

**5. Add credentials to `.env`**

```bash
KEYCARD_CLIENT_ID=<application client id>
KEYCARD_CLIENT_SECRET=<application client secret>
GITHUB_RESOURCE=https://api.github.com
```

**6. Restart and re-connect**

Restart the server. The banner should now say `Delegated access: ON`. Restart Cursor (or reconnect the MCP server) so it re-lists tools.

**7. Test**

GitHub consent is collected when you connect, not when a tool is called, so sign in again:

1. Open Cursor Settings (`Cmd+Shift+J`), go to **Tools & MCP**, and click **Logout** on the keycard-mcp-demo entry.
2. Click **Connect**. The browser opens the Keycard sign-in, and this time it includes the consent screen listing the GitHub access the Application requests. Approve it.

In a Cursor Agent chat (not the terminal), type these prompts:

- "What GitHub user am I logged in as?" The agent should call `whoami_github`, and the chat shows your GitHub login.
- "Which of my public GitHub repos were updated most recently?" The agent should call `list_my_repos`, and the chat lists up to 5 of your public repos.

If a tool instead reports `insufficient_authorization`, the consent didn't take. Repeat the Logout and Connect steps above.

## References

- [Add Auth to Custom MCP](https://docs.keycard.ai/guides/mcp-server/)
- [Call External APIs from MCP](https://docs.keycard.ai/guides/delegated-access/)
- Concepts: [Zones](https://docs.keycard.ai/concepts/zones/), [Resources](https://docs.keycard.ai/concepts/resources/), [Applications](https://docs.keycard.ai/concepts/applications/), [Providers](https://docs.keycard.ai/concepts/providers/), [Credentials](https://docs.keycard.ai/concepts/credentials/)
- [`@keycardai/mcp` on npm](https://www.npmjs.com/package/@keycardai/mcp)
- [Keycard TypeScript SDK](https://github.com/keycardai/typescript-sdk)
