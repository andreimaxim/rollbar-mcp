# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/andreimaxim/rollbar-mcp"
LABEL org.opencontainers.image.description="Read-only Rollbar MCP server"
LABEL io.modelcontextprotocol.server.name="io.github.andreimaxim/rollbar-mcp"

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
ENTRYPOINT ["node", "dist/index.js"]
