# Production image: compiles the Next.js bundle at build time and serves
# it with `next start`. Dev (`docker-compose.yml`) overrides the command
# to `npm run dev` and bind-mounts source for hot reload.
FROM artifact.enflame.cn/enflame_docker_images/ci/node:22-alpine
WORKDIR /app

# Lockfile-aware install if present; falls back to npm install.
COPY package.json package-lock.json* ./
RUN npm config set registry http://data-oceanus.enflame.cn/artifactory/api/npm/npm_virtual/ &&  npm install --legacy-peer-deps

COPY . .

# Build the production bundle. Kept inline (not multi-stage) so the
# devDependencies needed for the build also remain available for the
# dev-mode bind-mount workflow.
RUN npm run build

EXPOSE 3001
CMD ["npm", "start"]
