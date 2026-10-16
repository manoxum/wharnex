# The default is the existing control image; its tag is a shipped lifecycle
# compatibility boundary. Browser dependencies stay out of application images.
ARG WHARNEX_TOOLS_BASE=wharness-backend:harness
FROM ${WHARNEX_TOOLS_BASE}
USER root
RUN apk add --no-cache chromium font-noto font-noto-emoji
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
WORKDIR /work/services/frontend
ENTRYPOINT []
CMD ["npm", "test", "--", "--run"]
