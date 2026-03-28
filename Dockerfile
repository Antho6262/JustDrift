FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install --production

COPY index.js ./
COPY votes.db ./

CMD ["node", "index.js"]
