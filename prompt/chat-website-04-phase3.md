Extend the existing chat app (client/ React+Vite+TS+Tailwind, server/ Express+Socket.IO+MongoDB). Do NOT rewrite existing code. Keep it simple and lean, no heavy testing, just make sure it runs.

PHASE 3 FEATURES
1. Reply: reply to a specific message in channels and DMs
   - Message gets optional replyTo (message id); show a small quoted preview (author + truncated text) above the reply; click it to scroll to/highlight the original
   - If the original is deleted, show "Original message deleted"
2. Threads: open a thread on any channel message
   - Side panel showing the parent message and its thread replies, real-time via Socket.IO
   - Show reply count and last reply time under the parent message
   - Thread replies do not appear in the main channel list
   - Thread replies count toward unread for people who participated in the thread
3. Message search
   - Search box in the header; search messages in the current server (all channels the user can access) and in the user's DMs
   - MongoDB text index on message content; paginated results showing channel/DM, author, time, and a snippet
   - Click a result to jump to that channel/DM and the message
   - Only search content the user has permission to read (enforce on server)
4. Browser notifications
   - Ask for Notification permission via a small button/toggle in settings (not on page load)
   - Show a notification for: new DM, @mention, reply to the user's message, when the tab is not focused
   - Support @username mentions in messages (highlight them in the UI)
   - Per-user toggle to turn notifications on/off, stored in the user profile

RULES
- Add only the model fields/indexes needed (replyTo, threadParent, threadCount, mentions, text index, notification setting)
- Check permissions on the server for every new endpoint and socket event
- Build in this order: reply -> mentions + notifications -> search -> threads
- Don't add features beyond this list
- At the end, summarize briefly what changed and any new commands to run