FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
