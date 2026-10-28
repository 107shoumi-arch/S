FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S stockpilot && adduser -S stockpilot -u 1001
COPY --from=build --chown=stockpilot:stockpilot /app/.next/standalone ./
COPY --from=build --chown=stockpilot:stockpilot /app/.next/static ./.next/static
COPY --from=build --chown=stockpilot:stockpilot /app/public ./public
USER stockpilot
EXPOSE 3000
CMD ["node", "server.js"]
