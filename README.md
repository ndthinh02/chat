# Gather — community chat MVP

A small group-chat app built with React, Vite, TypeScript, Tailwind CSS, Express, Socket.IO, and MongoDB/Mongoose.

## Run locally

1. Install Node.js 20+ and start a local MongoDB instance.
2. Run `npm install` in the project root.
3. Copy `.env.example` to `.env` and set `MONGODB_URI`, a long random `JWT_SECRET`, and the three `CLOUDINARY_*` values. The defaults for `PORT` and `CLIENT_URL` work with the development setup.
4. Run `npm run dev`, then open `http://localhost:5173`.

The web app uses Vite's proxy for `/api`, `/uploads`, and `/socket.io`; the API runs on port 4000 by default. Run `npm run build` to check and build the client. Run `npm start` to start the API without file watching.

Create an account, create a server, and share its invite code with another account. Messages are stored in MongoDB and loaded 30 at a time when scrolling up.

Phase 2 adds direct messages, reactions, unread counts, profile avatars, image attachments, and server roles. Owners and admins manage channels and members; only owners manage admins or delete a server. New images are stored in Cloudinary and must be JPG, PNG, or WebP files no larger than 5 MB. Existing local images remain available from `server/uploads/` in local development.

## Deploy to Render

Create one Node web service from the project root. Use `npm run build` as the build command and `npm start` as the start command. Set `MONGODB_URI`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `NODE_ENV=production` in Render. Render supplies `PORT` automatically. `CLIENT_URL` is only needed for local development CORS.
