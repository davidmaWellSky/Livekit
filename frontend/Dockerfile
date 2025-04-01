FROM node:18-alpine as build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all project files
COPY . .

# Install Angular build dependencies if needed
RUN npm install --save-dev @angular-devkit/build-angular@16.1.0

# Build the Angular application for production
RUN npm run build -- --configuration production

# Stage 2: Create the production image with Nginx
FROM nginx:alpine

# Copy the built Angular app from the build stage
COPY --from=build /app/dist/frontend /usr/share/nginx/html

# Copy Nginx configuration
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]