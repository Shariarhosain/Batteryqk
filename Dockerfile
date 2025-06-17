# Use official Node.js LTS image
FROM node:22

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose app port (change if needed)
EXPOSE 3000

# Start the app
CMD ["node", "src/app.js"]
