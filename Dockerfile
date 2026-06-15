FROM node:22-alpine

RUN apk upgrade --no-cache && npm install -g npm@latest

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/

USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
