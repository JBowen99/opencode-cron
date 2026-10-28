FROM node:22-alpine AS build
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src src
COPY shared shared
COPY sandbox sandbox
COPY scripts scripts
COPY public/theme.css public/theme.css
COPY public/favicon.svg public/favicon.svg
RUN pnpm run build && pnpm prune --prod

FROM node:22-alpine
RUN mkdir -p /data/logs && chown -R node:node /data
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/public/app.css ./public/app.css
COPY --from=build /src/public/favicon.svg ./public/favicon.svg
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787
ENV HOST=0.0.0.0
ENV SANDBOX_URL=http://sandbox:8788
USER node
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
