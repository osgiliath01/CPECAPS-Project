# The app as everyone uses it: built once, then served by nginx together with the backend.
# Built by Backend/docker-compose.yml (service "web"), normally through deploy.ps1.

# 1. Build the React app into plain files
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Version stamp, filled in by deploy.ps1 (shown in the app's menu and on the sign-in page)
ARG APP_VERSION=dev
ARG APP_COMMIT=dev
ARG APP_BRANCH=local
ARG APP_BUILT=
ENV VITE_API_URL=/api \
    VITE_APP_VERSION=$APP_VERSION \
    VITE_APP_COMMIT=$APP_COMMIT \
    VITE_APP_BRANCH=$APP_BRANCH \
    VITE_APP_BUILT=$APP_BUILT
RUN npm run build \
 && printf '{"version":"%s","commit":"%s","branch":"%s","built":"%s"}\n' \
      "$APP_VERSION" "$APP_COMMIT" "$APP_BRANCH" "$APP_BUILT" > dist/version.json

# 2. Serve the files, and pass /api/... on to the backend
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
