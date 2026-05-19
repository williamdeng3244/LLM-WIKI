# Production image: compiles the Next.js bundle at build time and serves
# it with `next start`. Dev (`docker-compose.yml`) overrides the command
# to `npm run dev` and bind-mounts source for hot reload.
FROM node:20-alpine
WORKDIR /app

# Lockfile-aware install if present; falls back to npm install.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

# Build the production bundle. Kept inline (not multi-stage) so the
# devDependencies needed for the build also remain available for the
# dev-mode bind-mount workflow.
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
