FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy remaining files
COPY . .

# Ensure production mode
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
