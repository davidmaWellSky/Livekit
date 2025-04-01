FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Install dependencies with legacy peer deps to handle potential npm registry issues
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 3001

CMD ["npm", "start"]