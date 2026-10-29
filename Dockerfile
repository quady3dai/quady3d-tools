FROM node:22-bookworm-slim

# Run the immutable public package. No account credentials are baked into the image.
RUN npm install --global --ignore-scripts --no-audit --no-fund @quady3d/mcp@0.1.2 \
    && mkdir /project \
    && chown node:node /project

USER node
WORKDIR /project
ENTRYPOINT ["quady3d-mcp"]
CMD ["--root", "/project"]
