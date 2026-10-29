Prepare the existing chat app for single-service deployment on Render. Do NOT change features. Keep it minimal, no extra tests.

1. Production serving: in production, Express serves the built client (client/dist) as static files with SPA fallback (non-/api and non-/socket.io routes return index.html). Client must use relative URLs (/api, same-origin Socket.IO), no hardcoded localhost.
2. Root package.json scripts: "build" (install + build client) and "start" (node server/index.js). Server listens on process.env.PORT.
3. Image/avatar uploads: replace local disk storage with Cloudinary (multer memory storage -> Cloudinary upload), store the returned URL in MongoDB. Keep the same file type/size validation. Env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
4. Cookies/CORS in production: secure cookie when NODE_ENV=production, trust proxy enabled (app.set("trust proxy", 1)); CORS only needed for local dev.
5. Add a GET /api/health endpoint.
6. Update .env.example (MONGODB_URI, JWT_SECRET, CLIENT_URL, CLOUDINARY_*, NODE_ENV) and add a short "Deploy to Render" section in README: build command, start command, env vars.