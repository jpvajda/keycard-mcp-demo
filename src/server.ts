/**
 * Keycard delegated-access demo: a protected MCP server that calls GitHub
 * as the signed-in user.
 *
 * Request flow (see README for the diagram):
 *   1. requireBearerAuth  -> verifies the Keycard JWT (issuer + audience).
 *   2. authProvider.grant -> exchanges that JWT for a GitHub token (Part 2).
 *   3. MCP tool handlers  -> use the exchanged token to call api.github.com.
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@keycardai/mcp/server/auth/middleware/bearerAuth";
import { mcpAuthMetadataRouter } from "@keycardai/mcp/server/auth/router";
import { AuthProvider } from "@keycardai/mcp/server/auth/provider";
import type { AccessContext, DelegatedRequest } from "@keycardai/mcp/server/auth/provider";
import { ClientSecret } from "@keycardai/mcp/server/auth/credentials";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ZONE_URL = process.env.KEYCARD_ZONE_URL;
if (!ZONE_URL) {
  console.error(
    "Missing KEYCARD_ZONE_URL. Copy .env.example to .env and set it " +
      "(Keycard Console -> Settings -> Connection -> Issuer URL).",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 8080);
// Must match the Resource Identifier registered in Keycard Console exactly.
const MCP_RESOURCE = `http://localhost:${PORT}/mcp`;

const CLIENT_ID = process.env.KEYCARD_CLIENT_ID;
const CLIENT_SECRET = process.env.KEYCARD_CLIENT_SECRET;
const GITHUB_RESOURCE = process.env.GITHUB_RESOURCE ?? "https://api.github.com";

// Part 2 (delegated access) is on only when Application credentials are set.
// Without them the server runs as a plain Part 1 "protected hello world".
const delegatedEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);

const authProvider = delegatedEnabled
  ? new AuthProvider({
      zoneUrl: ZONE_URL,
      applicationCredential: new ClientSecret(CLIENT_ID!, CLIENT_SECRET!),
    })
  : undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });
const fail = (value: string): ToolResult => ({ ...text(value), isError: true });

/**
 * Get a GitHub token for the current user from the per-request AccessContext,
 * or explain why we can't. Returns either { token } or { error }.
 */
function getGithubToken(
  accessContext: AccessContext | undefined,
): { token: string } | { error: ToolResult } {
  if (!delegatedEnabled || !accessContext) {
    return {
      error: fail(
        "Delegated access is not configured. Set KEYCARD_CLIENT_ID and " +
          "KEYCARD_CLIENT_SECRET in .env (see README, Part 2) and restart the server.",
      ),
    };
  }
  if (accessContext.hasErrors()) {
    return {
      error: fail(
        "Keycard could not issue a GitHub token for this user. " +
          "Check that GitHub is a Dependency of your Keycard Application and that you " +
          `completed the GitHub consent flow.\n\n${JSON.stringify(accessContext.getErrors(), null, 2)}`,
      ),
    };
  }
  return { token: accessContext.access(GITHUB_RESOURCE).accessToken };
}

async function githubGet(token: string, path: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "keycard-mcp-demo",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ${response.statusText} for GET ${path}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// MCP server (one instance per request: stateless mode)
// ---------------------------------------------------------------------------

function buildMcpServer(accessContext: AccessContext | undefined): McpServer {
  const server = new McpServer({ name: "keycard-mcp-demo", version: "1.0.0" });

  // Part 1: proves the Keycard sign-in and bearer-token check work.
  server.registerTool(
    "hello_world",
    {
      description: "Say hello to an authenticated user.",
      inputSchema: { name: z.string().describe("Name to greet") },
    },
    async ({ name }) => text(`Hello, ${name}! You are authenticated.`),
  );

  // Part 2: calls GitHub as the signed-in user via Keycard token exchange.
  server.registerTool(
    "whoami_github",
    {
      description: "Return the GitHub login and profile of the signed-in user.",
    },
    async () => {
      const result = getGithubToken(accessContext);
      if ("error" in result) return result.error;
      try {
        const user = (await githubGet(result.token, "/user")) as {
          login: string;
          name: string | null;
          html_url: string;
        };
        return text(JSON.stringify({ login: user.login, name: user.name, url: user.html_url }, null, 2));
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  server.registerTool(
    "list_my_repos",
    {
      description: "List the signed-in user's 5 most recently updated PUBLIC GitHub repos.",
    },
    async () => {
      const result = getGithubToken(accessContext);
      if ("error" in result) return result.error;
      try {
        // visibility=public is belt-and-braces: keep the GitHub scopes in
        // Keycard Console to read:user + public_repo so private repos are
        // unreachable even if this query is changed.
        const repos = (await githubGet(
          result.token,
          "/user/repos?visibility=public&sort=updated&per_page=5",
        )) as { full_name: string; html_url: string; description: string | null }[];
        return text(
          JSON.stringify(
            repos.map((r) => ({ name: r.full_name, url: r.html_url, description: r.description })),
            null,
            2,
          ),
        );
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Unauthenticated OAuth discovery endpoints (.well-known/*). MCP clients read
// these to learn which Keycard zone to sign in to.
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata: { issuer: ZONE_URL },
    resourceName: "Keycard MCP Demo",
  }),
);

// Verifies the Keycard JWT. Rejects other issuers and tokens whose audience is
// not this server's Resource Identifier.
const bearerAuth = requireBearerAuth({ issuers: ZONE_URL, audiences: MCP_RESOURCE });

// Exchanges the verified user token for a GitHub token. It never rejects the
// request on failure; it records errors on req.accessContext so hello_world
// keeps working and GitHub tools can explain what went wrong.
const grantGithub = authProvider ? [authProvider.grant(GITHUB_RESOURCE)] : [];

app.post("/mcp", bearerAuth, ...grantGithub, async (req, res) => {
  const accessContext = (req as Partial<DelegatedRequest>).accessContext;
  const server = buildMcpServer(accessContext);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request failed:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode: no server-initiated streams or sessions.
const methodNotAllowed: express.RequestHandler = (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Keycard MCP demo listening on ${MCP_RESOURCE}`);
  console.log(`  Zone:             ${ZONE_URL}`);
  console.log(
    delegatedEnabled
      ? `  Delegated access: ON  (GitHub resource: ${GITHUB_RESOURCE})`
      : "  Delegated access: OFF (set KEYCARD_CLIENT_ID/SECRET for GitHub tools)",
  );
});
