FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_REMOTE_APP=false
ENV VITE_REMOTE_APP=$VITE_REMOTE_APP
ARG VITE_WHARNESS_INSTANCE_ID=
ENV VITE_WHARNESS_INSTANCE_ID=$VITE_WHARNESS_INSTANCE_ID
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
