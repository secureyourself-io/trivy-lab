FROM node:18.12.0-alpine3.16

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/

USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
