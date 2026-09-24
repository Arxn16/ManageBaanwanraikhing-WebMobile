# บ้านแว่นไร่ขิง — image สำหรับรันเป็น server ภายในร้าน
# ใช้งานผ่าน docker compose:  docker compose up -d --build

# ---------- ขั้นที่ 1: สร้างไฟล์ CSS จาก styles/input.css ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tailwind.config.js ./
COPY styles ./styles
COPY public ./public
RUN npm run build:css

# ---------- ขั้นที่ 2: ตัวระบบ (มีแค่ Express + SQLite ที่มากับ Node.js) ----------
FROM node:24-slim
ENV NODE_ENV=production \
    TZ=Asia/Bangkok \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/public ./public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
