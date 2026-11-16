FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public

# Carpeta de datos (se monta como volumen compartido entre los 3 nodos)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
ENV PORT=9090
EXPOSE 9090

CMD ["node", "server.js"]
