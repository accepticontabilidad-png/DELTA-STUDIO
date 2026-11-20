FROM node:22-slim
# Chromium y tipografías: el departamento de Diseño los usa para convertir sus diseños en imágenes PNG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
  && apt-get clean && find /var/lib/apt/lists -type f -delete
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
