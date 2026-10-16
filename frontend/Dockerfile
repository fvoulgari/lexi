FROM node:24-alpine
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/app/csv_example.json /app/backend/app/csv_example.json
EXPOSE 5173
CMD ["npm", "run", "dev"]
