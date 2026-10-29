Continue the existing chat app (client/ React+Vite+TS+Tailwind, server/ Express+Socket.IO+MongoDB). Do NOT rewrite existing code; extend it. Keep code simple and lean, no heavy testing, just make sure it runs.

PHASE 2 FEATURES
1. Direct messages (1-1): open a DM with any user, real-time, history with pagination, separate DM list in the sidebar
2. Image upload in messages (channel + DM): jpg/png/webp, max 5MB, stored on server disk (/server/uploads), served statically; show inline preview
3. Emoji reactions on messages: add/remove, show counts, real-time sync
4. Roles per server: owner, admin, member
   - owner/admin: delete any message, kick members, create/delete channels
   - owner: promote/demote admins, delete server
   - Enforce all permissions on the server side
5. Unread badges: per channel and per DM, cleared when opened
6. User profile: display name + avatar (upload), shown in messages and member list

RULES
- Add new Mongoose models/fields only where needed (DirectMessage/Conversation, reactions on Message, role on membership, lastRead per user)
- Validate file type/size on server; sanitize filenames
- Update .env.example and README only if something new is required
- Build in this order: roles -> reactions -> unread -> profile/avatar -> image upload -> DMs
- Don't add features beyond this list
- At the end, summarize briefly what changed and any new commands to run