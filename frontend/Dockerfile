FROM node:20-alpine

WORKDIR /app

# Copy package descriptors and install packages
COPY package.json package-lock.json ./
RUN npm install

# Copy all files
COPY . .

# Expose port 5173
EXPOSE 5173

# Run the dev server and bind to all hosts
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
