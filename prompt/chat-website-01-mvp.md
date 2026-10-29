Build an MVP community group-chat web app (mini Discord/Slack). Keep the code simple and lean; no heavy testing, just make sure it runs.

TECH STACK
- Frontend: React + Vite + TypeScript, Tailwind CSS
- Backend: Node.js + Express + Socket.IO
- Database: MongoDB (Mongoose). Do NOT use Supabase/Postgres.
- Auth: email + password, JWT (httpOnly cookie), bcrypt

FEATURES (MVP)
1. Register / login / logout
2. Servers (communities): create, join via invite code, leave
3. Channels inside each server: create, list, switch
4. Real-time messaging per channel (Socket.IO rooms), message history with pagination (load older on scroll)
5. Online/offline member list per server
6. Typing indicator
7. Edit/delete own messages

UI
- 3-column layout: server list | channel list | chat area (+ member list on the right)
- Dark theme, responsive, clean and minimal

STRUCTURE
- /client (React app), /server (Express API + Socket.IO)
- Models: User, Server, Channel, Message
- .env.example for MONGODB_URI, JWT_SECRET, PORT, CLIENT_URL
- README with short run instructions (install, env, dev commands)

RULES
- Build step by step: backend -> auth -> servers/channels -> realtime chat -> UI polish
- Validate input and check permissions on the server (only members can read/post in a channel)
- Don't add features beyond the list above
- At the end, summarize briefly what was built and how to run it