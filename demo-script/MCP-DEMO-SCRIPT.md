**[0:00–0:25] Open on the problem**

When an agent calls an API on your behalf, there are usually two bad options you have for authorization and access. You can either: paste a personal access token into a config file for the agent to use, or give the server one shared key, so every request runs as the same GitHub account.

To show what Keycard does, I built an MCP server that does neither. Keycard protects it, and it calls GitHub as the signed-in user. On each request Keycard hands the server that user's GitHub token. The server uses it and does not store it.

**[0:25–0:55] Show the code has no secret**

> Open `keycard-mcp-demo/.env.example`. Do not open `.env`.

Here's the example env with placeholders for the Keycard zone URL and an Application client ID and secret. The client ID and secret identify this server with Keycard. They are not GitHub credentials.

> Open `src/server.ts`. Scroll to the `requireBearerAuth` line (~192), then the `authProvider.grant` line (~197).

Two lines do the work. `requireBearerAuth` checks the Keycard token on the request. It has to come from my zone, and it has to be issued for this server. `authProvider.grant` swaps that token for a GitHub token for the signed-in user.

**[0:55–1:25] Show the Keycard side, fast**

> Switch to Keycard Console.

Four things had to exist. A Resource for this MCP server, so tokens are minted with this server as the audience. A Resource for the GitHub API, holding the OAuth app. An Application for the server, with a client ID and secret. And two links on that Application: it provides the MCP server and depends on GitHub. The scopes are `read:user` and `public_repo`, so even if someone edits the code, private repos are out of reach.

**[1:25–1:50] Prove it's locked**

> Terminal, server already running. Point at the `Delegated access: ON` line in the banner.

The server is up and delegated access is on. First, what happens with no token?

```bash
curl -i -X POST http://localhost:8080/mcp -H 'content-type: application/json' -d '{}'
```

401, with a `WWW-Authenticate` header pointing at the Keycard zone. That's how an MCP client discovers where to sign in via a `/.well-known` defined path.

**[1:50–2:30] Sign in from Cursor**

> Cursor Settings → Tools & MCP → `keycard-mcp-demo`. Click **Logout**, then **Connect**.

Cursor saw that 401, found the Keycard zone, and opened a browser. I sign in. Because this app is allowed to call GitHub, Keycard shows a consent screen: my profile, and my public repos. I approve it once. Keycard remembers that approval and refreshes the GitHub access. I never see a token.

> Back in Cursor, expand the server. Show the three tools: `hello_world`, `whoami_github`, `list_my_repos`.

**[2:30–3:10] Run it**

> Cursor Agent chat. Type:

Now lets prompt the agent to use some of the tools provided by our MCP Server:

prompt: "What GitHub user am I logged in as?"

The agent calls `whoami_github`, and it comes back with my GitHub login. That call went to `api.github.com` with a token minted for me.

> Type:

prompt: "Which of my public GitHub repos were updated most recently?"

Five most recently updated public repos. The query asks for public only, and the scopes in Keycard enforce it even if the query changed.

prompt: "Show me all my private GitHub repos."

**[3:10–3:40] Show the audit trail**

> Switch to Keycard Console → Audit Log.

And here's the proof. `users:authenticate`, `users:authorize`, and `credentials:issue`, timestamped to the seconds I just ran those prompts. Every GitHub token handed out is tied to a user, an application, and a resource.

**[3:40–4:10] Close**

Keycard's SDK handles sign-in, checking the token, and swapping it for a GitHub token. What I wrote is about 240 lines. Three tools, one auth check, and one call that asks Keycard for the GitHub token. There is no GitHub secret in the repo, and no shared key. Each user only reaches their own GitHub data. Swap GitHub for any other API in Keycard's catalog, and this same setup still works.

---