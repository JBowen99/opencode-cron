# Coolify: set the base directory to site/ and assign the public domain to this app.
# The scheduler in the repository root stays on the private port.
FROM node:22-alpine AS build
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV ASTRO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
