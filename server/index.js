import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import path from "node:path";
import { Server as SocketServer } from "socket.io";
import { User, Server, Channel, Message, Conversation } from "./models.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const {
  MONGODB_URI,
  JWT_SECRET,
  CLIENT_URL = "http://localhost:5173",
  PORT = 4000,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error("Set MONGODB_URI and JWT_SECRET in .env");
  process.exit(1);
}

const production = process.env.NODE_ENV === "production";
if (production && (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET)) {
  console.error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET");
  process.exit(1);
}
cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);
const io = new SocketServer(httpServer, production ? {} : {
  cors: { origin: CLIENT_URL, credentials: true },
});
const uploadsDir = fileURLToPath(new URL("./uploads/", import.meta.url));
const clientDist = fileURLToPath(new URL("../client/dist/", import.meta.url));
if (!production) app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

const validId = (id) => mongoose.isValidObjectId(id);
const clean = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max + 1) : "";
const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res)).catch(next);
const userView = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl || null,
  notificationsEnabled: user.notificationsEnabled || false,
});
const reactionsView = (message) =>
  (message.reactions || []).map((reaction) => ({
    emoji: reaction.emoji,
    userIds: reaction.users.map(String),
  }));
const messageView = (message) => ({
  id: String(message._id),
  channelId: message.channel ? String(message.channel) : null,
  conversationId: message.conversation ? String(message.conversation) : null,
  author: {
    id: String(message.author._id),
    name: message.author.name,
    avatarUrl: message.author.avatarUrl || null,
  },
  content: message.content,
  imageUrl: message.imageUrl || null,
  reactions: reactionsView(message),
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  replyTo: message.replyTo
    ? String(message.replyTo._id || message.replyTo)
    : null,
  replyPreview:
    message.replyTo && message.replyTo.author
      ? {
          author: message.replyTo.author.name,
          content:
            message.replyTo.content ||
            (message.replyTo.imageUrl ? "Image" : ""),
        }
      : null,
  threadParent: message.threadParent ? String(message.threadParent) : null,
  threadCount: message.threadCount || 0,
  lastThreadReplyAt: message.lastThreadReplyAt || null,
  mentions: (message.mentions || []).map(String),
});
const replyPopulate = {
  path: "replyTo",
  select: "author content imageUrl",
  transform: (doc, id) => doc || { _id: id },
  populate: { path: "author", select: "name" },
};
const populateMessage = (query) =>
  query.populate("author", "name avatarUrl").populate(replyPopulate);
async function mentionIds(content, channel, conversation) {
  const names = [...content.matchAll(/@([\p{L}\p{N}_]+)/gu)].map((match) =>
    match[1].toLowerCase(),
  );
  if (!names.length) return [];
  const allowed = channel
    ? (await Server.findById(channel.server).select("members")).members
    : conversation.members;
  const users = await User.find({ _id: { $in: allowed } }).select("name");
  return users
    .filter((user) =>
      names.includes(
        user.name
          .trim()
          .replace(/[^\p{L}\p{N}_]+/gu, "_")
          .toLowerCase(),
      ),
    )
    .map((user) => user._id);
}
async function sendNotifications(message, channel, conversation, replyTarget) {
  const recipients = new Map();
  if (conversation)
    for (const id of conversation.members)
      if (String(id) !== String(message.author._id))
        recipients.set(String(id), "dm");
  for (const id of message.mentions || [])
    if (String(id) !== String(message.author._id))
      recipients.set(String(id), "mention");
  if (replyTarget && String(replyTarget.author) !== String(message.author._id))
    recipients.set(String(replyTarget.author), "reply");
  const enabled = await User.find({
    _id: { $in: [...recipients.keys()] },
    notificationsEnabled: true,
  }).select("_id");
  for (const user of enabled)
    io.to(`user:${user._id}`).emit("notification:new", {
      message: messageView(message),
      kind: recipients.get(String(user._id)),
      serverId: channel ? String(channel.server) : null,
    });
}
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function tokenUser(token) {
  try {
    return jwt.verify(token, JWT_SECRET).id;
  } catch {
    return null;
  }
}
const requireAuth = (req, _res, next) => {
  (async () => {
    const id = tokenUser(req.cookies.token);
    if (!validId(id)) throw fail(401, "Please sign in");
    const user = await User.findById(id);
    if (!user) throw fail(401, "Please sign in");
    req.user = user;
    next();
  })().catch(next);
};

async function memberServer(serverId, userId) {
  if (!validId(serverId)) throw fail(404, "Server not found");
  const server = await Server.findById(serverId);
  if (!server) throw fail(404, "Server not found");
  if (!server.members.some((id) => String(id) === String(userId)))
    throw fail(403, "Server membership required");
  return server;
}
function roleOf(server, userId) {
  if (String(server.owner) === String(userId)) return "owner";
  if (server.admins?.some((id) => String(id) === String(userId)))
    return "admin";
  return "member";
}
function requireRole(server, userId, roles) {
  if (!roles.includes(roleOf(server, userId)))
    throw fail(403, "Insufficient permissions");
}
async function memberChannel(channelId, userId) {
  if (!validId(channelId)) throw fail(404, "Channel not found");
  const channel = await Channel.findById(channelId);
  if (!channel) throw fail(404, "Channel not found");
  await memberServer(channel.server, userId);
  return channel;
}
function serverView(server) {
  return {
    id: String(server._id),
    name: server.name,
    inviteCode: server.inviteCode,
    ownerId: String(server.owner),
    adminIds: (server.admins || []).map(String),
    memberCount: server.members.length,
  };
}
function channelView(channel) {
  return {
    id: String(channel._id),
    serverId: String(channel.server),
    name: channel.name,
  };
}
function onlineIds(serverId) {
  const room = io.sockets.adapter.rooms.get(`server:${serverId}`);
  return [
    ...new Set(
      [...(room || [])]
        .map((id) => io.sockets.sockets.get(id)?.data.userId)
        .filter(Boolean),
    ),
  ];
}
function emitPresence(serverId) {
  io.to(`server:${serverId}`).emit("presence", {
    serverId: String(serverId),
    userIds: onlineIds(serverId),
  });
}
async function syncUserSockets(userId, serverId, join) {
  const channelIds = join
    ? []
    : (await Channel.find({ server: serverId }).select("_id")).map(
        (channel) => `channel:${channel._id}`,
      );
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId !== String(userId)) continue;
    if (join) socket.join(`server:${serverId}`);
    else {
      socket.leave(`server:${serverId}`);
      for (const room of channelIds) socket.leave(room);
    }
  }
  emitPresence(serverId);
}
async function memberConversation(conversationId, userId) {
  if (!validId(conversationId)) throw fail(404, "Conversation not found");
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw fail(404, "Conversation not found");
  if (!conversation.members.some((id) => String(id) === String(userId)))
    throw fail(403, "Conversation access denied");
  return conversation;
}
async function messageAccess(message, userId) {
  return message.channel
    ? memberServer((await Channel.findById(message.channel))?.server, userId)
    : memberConversation(message.conversation, userId);
}
app.use(
  "/uploads",
  requireAuth,
  (req, _res, next) => {
    (async () => {
      if (!/^\/[a-f0-9]{24}-[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.path))
        throw fail(404, "Image not found");
      const imageUrl = `/uploads${req.path}`;
      if (await User.exists({ avatarUrl: imageUrl })) return next();
      const messages = await Message.find({ imageUrl });
      for (const message of messages) {
        try {
          await messageAccess(message, req.user._id);
          return next();
        } catch {
          /* Try another conversation that shares the image. */
        }
      }
      throw fail(404, "Image not found");
    })().catch(next);
  },
  express.static(uploadsDir),
);
function messageRoom(message) {
  return message.channel
    ? `channel:${message.channel}`
    : `dm:${message.conversation}`;
}
function imageType(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return ".jpg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return ".png";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return ".webp";
  return null;
}
const imageBody = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
      ? done(null, true)
      : done(fail(400, "Upload a JPG, PNG, or WebP image up to 5 MB")),
}).single("file");
async function saveImage(req) {
  const file = req.file;
  if (!file?.buffer?.length)
    throw fail(400, "Upload a JPG, PNG, or WebP image up to 5 MB");
  const extension = imageType(file.buffer);
  if (!extension || { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.mimetype] !== extension)
    throw fail(400, "File content does not match image type");
  const publicId = `${req.user._id}-${randomBytes(16).toString("hex")}`;
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "community-chat", public_id: publicId, resource_type: "image" },
      (error, uploaded) => error ? reject(error) : resolve(uploaded),
    );
    stream.end(file.buffer);
  });
  return result.secure_url;
}
async function validCloudinaryImage(imageUrl, userId) {
  if (typeof imageUrl !== "string") return false;
  const prefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/`;
  if (!imageUrl.startsWith(prefix)) return false;
  const suffix = imageUrl.slice(prefix.length);
  const match = new RegExp(`^v[0-9]+/community-chat/(${userId}-[a-f0-9]{32})\\.(jpg|png|webp)$`).exec(suffix);
  if (!match) return false;
  try {
    const resource = await cloudinary.api.resource(`community-chat/${match[1]}`, { resource_type: "image" });
    return resource.secure_url === imageUrl;
  } catch {
    return false;
  }
}

app.post(
  "/api/auth/register",
  wrap(async (req, res) => {
    const name = clean(req.body.name, 32);
    const email = clean(req.body.email, 254).toLowerCase();
    const password = req.body.password;
    if (
      name.length < 2 ||
      name.length > 32 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      throw fail(
        400,
        "Use a name (2–32 chars), valid email, and password (8–128 chars)",
      );
    if (await User.exists({ email }))
      throw fail(409, "Email already registered");
    let user;
    try {
      user = await User.create({
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
      });
    } catch (error) {
      if (error.code === 11000) throw fail(409, "Email already registered");
      throw error;
    }
    res
      .cookie(
        "token",
        jwt.sign({ id: String(user._id) }, JWT_SECRET, { expiresIn: "7d" }),
        cookieOptions,
      )
      .status(201)
      .json({ user: userView(user) });
  }),
);
app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const email = clean(req.body.email, 254).toLowerCase();
    const user = await User.findOne({ email });
    if (
      !user ||
      typeof req.body.password !== "string" ||
      !(await bcrypt.compare(req.body.password, user.passwordHash))
    )
      throw fail(401, "Invalid email or password");
    res
      .cookie(
        "token",
        jwt.sign({ id: String(user._id) }, JWT_SECRET, { expiresIn: "7d" }),
        cookieOptions,
      )
      .json({ user: userView(user) });
  }),
);
app.post("/api/auth/logout", (_req, res) =>
  res
    .clearCookie("token", {
      path: "/",
      sameSite: "lax",
      secure: cookieOptions.secure,
    })
    .json({ ok: true }),
);
app.get("/api/auth/me", requireAuth, (req, res) =>
  res.json({ user: userView(req.user) }),
);

app.get(
  "/api/servers",
  requireAuth,
  wrap(async (req, res) => {
    const servers = await Server.find({ members: req.user._id }).sort({
      createdAt: 1,
    });
    res.json({ servers: servers.map(serverView) });
  }),
);
app.post(
  "/api/servers",
  requireAuth,
  wrap(async (req, res) => {
    const name = clean(req.body.name, 48);
    if (name.length < 2 || name.length > 48)
      throw fail(400, "Server name must be 2–48 characters");
    const server = await Server.create({
      name,
      inviteCode: randomBytes(5).toString("hex").toUpperCase(),
      owner: req.user._id,
      members: [req.user._id],
    });
    await Channel.create({ server: server._id, name: "general" });
    await syncUserSockets(req.user._id, server._id, true);
    res.status(201).json({ server: serverView(server) });
  }),
);
app.post(
  "/api/servers/join",
  requireAuth,
  wrap(async (req, res) => {
    const code = clean(req.body.code, 20).toUpperCase();
    const server = await Server.findOne({ inviteCode: code });
    if (!server) throw fail(404, "Invite code not found");
    await Server.updateOne(
      { _id: server._id },
      { $addToSet: { members: req.user._id } },
    );
    const updated = await Server.findById(server._id);
    await syncUserSockets(req.user._id, server._id, true);
    io.to(`server:${server._id}`).emit("members:changed", {
      serverId: String(server._id),
    });
    res.json({ server: serverView(updated) });
  }),
);
app.post(
  "/api/servers/:serverId/leave",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    const remaining = server.members.filter(
      (id) => String(id) !== String(req.user._id),
    );
    await syncUserSockets(req.user._id, server._id, false);
    if (!remaining.length) {
      const channels = await Channel.find({ server: server._id }).select("_id");
      await Message.deleteMany({
        channel: { $in: channels.map((channel) => channel._id) },
      });
      await Channel.deleteMany({ server: server._id });
      await Server.deleteOne({ _id: server._id });
    } else {
      server.members = remaining;
      server.admins = server.admins.filter(
        (id) => String(id) !== String(req.user._id),
      );
      if (String(server.owner) === String(req.user._id)) {
        server.owner = remaining[0];
        server.admins = server.admins.filter(
          (id) => String(id) !== String(server.owner),
        );
      }
      await server.save();
      io.to(`server:${server._id}`).emit("members:changed", {
        serverId: String(server._id),
      });
    }
    res.json({ ok: true });
  }),
);
app.get(
  "/api/servers/:serverId/channels",
  requireAuth,
  wrap(async (req, res) => {
    await memberServer(req.params.serverId, req.user._id);
    const channels = await Channel.find({ server: req.params.serverId }).sort({
      createdAt: 1,
    });
    res.json({ channels: channels.map(channelView) });
  }),
);
app.post(
  "/api/servers/:serverId/channels",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    requireRole(server, req.user._id, ["owner", "admin"]);
    const name = clean(req.body.name, 32).toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(name))
      throw fail(400, "Use 2–32 letters, numbers, or hyphens");
    if (await Channel.exists({ server: req.params.serverId, name }))
      throw fail(409, "Channel already exists");
    const channel = await Channel.create({ server: req.params.serverId, name });
    io.to(`server:${req.params.serverId}`).emit(
      "channel:created",
      channelView(channel),
    );
    res.status(201).json({ channel: channelView(channel) });
  }),
);
app.delete(
  "/api/servers/:serverId/channels/:channelId",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    requireRole(server, req.user._id, ["owner", "admin"]);
    if (!validId(req.params.channelId)) throw fail(404, "Channel not found");
    const channel = await Channel.findOne({
      _id: req.params.channelId,
      server: server._id,
    });
    if (!channel) throw fail(404, "Channel not found");
    await Message.deleteMany({ channel: channel._id });
    await channel.deleteOne();
    io.to(`server:${server._id}`).emit("channel:deleted", {
      serverId: String(server._id),
      channelId: String(channel._id),
    });
    for (const socket of io.sockets.sockets.values())
      socket.leave(`channel:${channel._id}`);
    res.json({ ok: true });
  }),
);
app.patch(
  "/api/servers/:serverId/members/:userId/role",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    requireRole(server, req.user._id, ["owner"]);
    if (
      !validId(req.params.userId) ||
      !server.members.some((id) => String(id) === req.params.userId) ||
      req.params.userId === String(server.owner)
    )
      throw fail(400, "Invalid member");
    if (!["admin", "member"].includes(req.body.role))
      throw fail(400, "Invalid role");
    server.admins = server.admins.filter(
      (id) => String(id) !== req.params.userId,
    );
    if (req.body.role === "admin") server.admins.push(req.params.userId);
    await server.save();
    io.to(`server:${server._id}`).emit("members:changed", {
      serverId: String(server._id),
    });
    res.json({ server: serverView(server) });
  }),
);
app.delete(
  "/api/servers/:serverId/members/:userId",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    requireRole(server, req.user._id, ["owner", "admin"]);
    if (
      !validId(req.params.userId) ||
      !server.members.some((id) => String(id) === req.params.userId) ||
      req.params.userId === String(server.owner)
    )
      throw fail(400, "Invalid member");
    if (
      roleOf(server, req.params.userId) === "admin" &&
      roleOf(server, req.user._id) !== "owner"
    )
      throw fail(403, "Only the owner can kick an admin");
    server.members = server.members.filter(
      (id) => String(id) !== req.params.userId,
    );
    server.admins = server.admins.filter(
      (id) => String(id) !== req.params.userId,
    );
    await server.save();
    await syncUserSockets(req.params.userId, server._id, false);
    io.to(`server:${server._id}`).emit("members:changed", {
      serverId: String(server._id),
    });
    io.to(`user:${req.params.userId}`).emit("server:kicked", {
      serverId: String(server._id),
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/servers/:serverId",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    requireRole(server, req.user._id, ["owner"]);
    const channels = await Channel.find({ server: server._id }).select("_id");
    io.to(`server:${server._id}`).emit("server:deleted", {
      serverId: String(server._id),
    });
    await Message.deleteMany({
      channel: { $in: channels.map((channel) => channel._id) },
    });
    await Channel.deleteMany({ server: server._id });
    await server.deleteOne();
    for (const socket of io.sockets.sockets.values())
      socket.leave(`server:${server._id}`);
    res.json({ ok: true });
  }),
);
app.get(
  "/api/servers/:serverId/members",
  requireAuth,
  wrap(async (req, res) => {
    const server = await memberServer(req.params.serverId, req.user._id);
    const populated = await server.populate("members", "name email avatarUrl");
    res.json({
      members: populated.members.map((member) => ({
        ...userView(member),
        role: roleOf(server, member._id),
      })),
      onlineIds: onlineIds(server._id),
    });
  }),
);
app.get(
  "/api/unread",
  requireAuth,
  wrap(async (req, res) => {
    const servers = await Server.find({ members: req.user._id }).select("_id");
    const channels = await Channel.find({
      server: { $in: servers.map((server) => server._id) },
    }).select("_id");
    const conversations = await Conversation.find({
      members: req.user._id,
    }).select("_id");
    const channelCounts = {};
    const dmCounts = {};
    await Promise.all(
      channels.map(async (channel) => {
        const lastRead = req.user.lastReadChannels?.get(String(channel._id));
        channelCounts[String(channel._id)] = await Message.countDocuments({
          channel: channel._id,
          threadParent: null,
          author: { $ne: req.user._id },
          ...(lastRead ? { createdAt: { $gt: lastRead } } : {}),
        });
        const participated = await Message.find({
          channel: channel._id,
          threadParent: null,
          $or: [
            { author: req.user._id },
            {
              _id: {
                $in: await Message.distinct("threadParent", {
                  channel: channel._id,
                  author: req.user._id,
                  threadParent: { $ne: null },
                }),
              },
            },
          ],
        }).select("_id");
        for (const parent of participated) {
          const read = req.user.lastReadChannels?.get(`thread:${parent._id}`);
          channelCounts[String(channel._id)] += await Message.countDocuments({
            threadParent: parent._id,
            author: { $ne: req.user._id },
            ...(read ? { createdAt: { $gt: read } } : {}),
          });
        }
      }),
    );
    await Promise.all(
      conversations.map(async (conversation) => {
        const lastRead = req.user.lastReadDms?.get(String(conversation._id));
        dmCounts[String(conversation._id)] = await Message.countDocuments({
          conversation: conversation._id,
          author: { $ne: req.user._id },
          ...(lastRead ? { createdAt: { $gt: lastRead } } : {}),
        });
      }),
    );
    res.json({ channels: channelCounts, dms: dmCounts });
  }),
);
app.post(
  "/api/channels/:channelId/read",
  requireAuth,
  wrap(async (req, res) => {
    await memberChannel(req.params.channelId, req.user._id);
    req.user.lastReadChannels.set(req.params.channelId, new Date());
    await req.user.save();
    res.json({ ok: true });
  }),
);
app.post(
  "/api/dms/:conversationId/read",
  requireAuth,
  wrap(async (req, res) => {
    await memberConversation(req.params.conversationId, req.user._id);
    req.user.lastReadDms.set(req.params.conversationId, new Date());
    await req.user.save();
    res.json({ ok: true });
  }),
);
app.patch(
  "/api/profile",
  requireAuth,
  wrap(async (req, res) => {
    const name = clean(req.body.name, 32);
    if (name.length < 2 || name.length > 32)
      throw fail(400, "Display name must be 2–32 characters");
    req.user.name = name;
    await req.user.save();
    for (const socket of io.sockets.sockets.values())
      if (socket.data.userId === String(req.user._id))
        socket.data.userName = name;
    io.emit("profile:updated", {
      id: String(req.user._id),
      name: req.user.name,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ user: userView(req.user) });
  }),
);
app.patch(
  "/api/profile/notifications",
  requireAuth,
  wrap(async (req, res) => {
    if (typeof req.body.enabled !== "boolean")
      throw fail(400, "Invalid notification setting");
    req.user.notificationsEnabled = req.body.enabled;
    await req.user.save();
    res.json({ user: userView(req.user) });
  }),
);
app.post(
  "/api/profile/avatar",
  requireAuth,
  imageBody,
  wrap(async (req, res) => {
    req.user.avatarUrl = await saveImage(req);
    await req.user.save();
    io.emit("profile:updated", {
      id: String(req.user._id),
      name: req.user.name,
      avatarUrl: req.user.avatarUrl,
    });
    res.json({ user: userView(req.user) });
  }),
);
app.post(
  "/api/uploads",
  requireAuth,
  imageBody,
  wrap(async (req, res) => {
    res.status(201).json({ imageUrl: await saveImage(req) });
  }),
);
app.get(
  "/api/users",
  requireAuth,
  wrap(async (req, res) => {
    const query = clean(req.query.query, 50);
    if (query.length < 2 || query.length > 50) return res.json({ users: [] });
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ],
    })
      .limit(20)
      .select("name email avatarUrl");
    res.json({ users: users.map(userView) });
  }),
);
app.get(
  "/api/dms",
  requireAuth,
  wrap(async (req, res) => {
    const conversations = await Conversation.find({ members: req.user._id })
      .sort({ updatedAt: -1 })
      .populate("members", "name email avatarUrl");
    res.json({
      conversations: conversations.map((conversation) => ({
        id: String(conversation._id),
        otherUser: userView(
          conversation.members.find(
            (member) => String(member._id) !== String(req.user._id),
          ),
        ),
      })),
    });
  }),
);
app.post(
  "/api/dms",
  requireAuth,
  wrap(async (req, res) => {
    const otherId = req.body.userId;
    if (!validId(otherId) || String(otherId) === String(req.user._id))
      throw fail(400, "Choose another user");
    const other = await User.findById(otherId);
    if (!other) throw fail(404, "User not found");
    const pairKey = [String(req.user._id), String(other._id)].sort().join(":");
    let conversation = await Conversation.findOne({ pairKey });
    if (!conversation) {
      try {
        conversation = await Conversation.create({
          members: [req.user._id, other._id],
          pairKey,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        conversation = await Conversation.findOne({ pairKey });
      }
    }
    for (const socket of io.sockets.sockets.values())
      if (conversation.members.some((id) => String(id) === socket.data.userId))
        socket.join(`dm:${conversation._id}`);
    io.to(`user:${other._id}`).emit("dm:created", {
      id: String(conversation._id),
      otherUser: userView(req.user),
    });
    res.json({
      conversation: {
        id: String(conversation._id),
        otherUser: userView(other),
      },
    });
  }),
);
app.get(
  "/api/dms/:conversationId/messages",
  requireAuth,
  wrap(async (req, res) => {
    await memberConversation(req.params.conversationId, req.user._id);
    res.json(
      await messagePage(
        { conversation: req.params.conversationId, threadParent: null },
        req.query.before,
        req.query.around,
      ),
    );
  }),
);
async function messagePage(baseQuery, before, around) {
  if (before && !validId(before)) throw fail(400, "Invalid message cursor");
  if (around && !validId(around)) throw fail(400, "Invalid message target");
  const query = { ...baseQuery };
  if (before || around) {
    const cursor = await Message.findOne({
      ...baseQuery,
      _id: before || around,
    });
    if (!cursor) throw fail(400, "Invalid message cursor");
    query.$or = [
      { createdAt: { [around ? "$lte" : "$lt"]: cursor.createdAt } },
      {
        createdAt: cursor.createdAt,
        _id: { [around ? "$lte" : "$lt"]: cursor._id },
      },
    ];
  }
  const messages = await populateMessage(
    Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(31),
  );
  return {
    messages: messages.slice(0, 30).reverse().map(messageView),
    hasMore: messages.length > 30,
  };
}
app.get(
  "/api/channels/:channelId/messages",
  requireAuth,
  wrap(async (req, res) => {
    await memberChannel(req.params.channelId, req.user._id);
    res.json(
      await messagePage(
        { channel: req.params.channelId, threadParent: null },
        req.query.before,
        req.query.around,
      ),
    );
  }),
);
app.get(
  "/api/messages/:messageId",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Message not found");
    const message = await populateMessage(
      Message.findById(req.params.messageId),
    );
    if (!message) throw fail(404, "Message not found");
    await messageAccess(message, req.user._id);
    res.json({ message: messageView(message) });
  }),
);
app.get(
  "/api/search",
  requireAuth,
  wrap(async (req, res) => {
    const query = clean(req.query.q, 100);
    const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
    if (query.length < 2 || query.length > 100)
      return res.json({ results: [], hasMore: false });
    let channelIds = [];
    if (req.query.serverId) {
      await memberServer(req.query.serverId, req.user._id);
      channelIds = (
        await Channel.find({ server: req.query.serverId }).select("_id")
      ).map((channel) => channel._id);
    }
    const dmIds = (
      await Conversation.find({ members: req.user._id }).select("_id")
    ).map((dm) => dm._id);
    const scope = [];
    if (channelIds.length) scope.push({ channel: { $in: channelIds } });
    if (dmIds.length) scope.push({ conversation: { $in: dmIds } });
    if (!scope.length) return res.json({ results: [], hasMore: false });
    const matches = await populateMessage(
      Message.find({ $text: { $search: query }, $or: scope })
        .sort({ createdAt: -1 })
        .skip((page - 1) * 20)
        .limit(21),
    );
    const channelMap = new Map(
      (
        await Channel.find({
          _id: {
            $in: matches.map((message) => message.channel).filter(Boolean),
          },
        }).select("name")
      ).map((channel) => [String(channel._id), channel.name]),
    );
    const dmMap = new Map(
      (
        await Conversation.find({
          _id: {
            $in: matches.map((message) => message.conversation).filter(Boolean),
          },
        }).populate("members", "name")
      ).map((dm) => [
        String(dm._id),
        dm.members.find((member) => String(member._id) !== String(req.user._id))
          ?.name || "DM",
      ]),
    );
    res.json({
      results: matches
        .slice(0, 20)
        .map((message) => ({
          ...messageView(message),
          location: message.channel
            ? `#${channelMap.get(String(message.channel))}`
            : `DM: ${dmMap.get(String(message.conversation))}`,
        })),
      hasMore: matches.length > 20,
    });
  }),
);
app.get(
  "/api/messages/:messageId/thread",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Message not found");
    const parent = await populateMessage(
      Message.findById(req.params.messageId),
    );
    if (!parent || !parent.channel || parent.threadParent)
      throw fail(404, "Thread not found");
    await memberChannel(parent.channel, req.user._id);
    const replies = await populateMessage(
      Message.find({ threadParent: parent._id }).sort({ createdAt: 1, _id: 1 }),
    );
    res.json({
      parent: messageView(parent),
      replies: replies.map(messageView),
    });
  }),
);
app.post(
  "/api/messages/:messageId/thread/read",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Thread not found");
    const parent = await Message.findById(req.params.messageId);
    if (!parent || !parent.channel || parent.threadParent)
      throw fail(404, "Thread not found");
    await memberChannel(parent.channel, req.user._id);
    req.user.lastReadChannels.set(`thread:${parent._id}`, new Date());
    await req.user.save();
    res.json({ ok: true });
  }),
);
app.patch(
  "/api/messages/:messageId",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Message not found");
    const message = await Message.findById(req.params.messageId);
    if (!message) throw fail(404, "Message not found");
    await messageAccess(message, req.user._id);
    if (String(message.author) !== String(req.user._id))
      throw fail(403, "You can edit only your messages");
    const content = clean(req.body.content, 2000);
    if ((!content && !message.imageUrl) || content.length > 2000)
      throw fail(400, "Message must have text or an image");
    message.content = content;
    message.mentions = await mentionIds(
      content,
      message.channel ? await Channel.findById(message.channel) : null,
      message.conversation
        ? await Conversation.findById(message.conversation)
        : null,
    );
    message.editedAt = new Date();
    await message.save();
    await message.populate([
      { path: "author", select: "name avatarUrl" },
      replyPopulate,
    ]);
    const view = messageView(message);
    io.to(messageRoom(message)).emit("message:updated", view);
    res.json({ message: view });
  }),
);
app.delete(
  "/api/messages/:messageId",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Message not found");
    const message = await Message.findById(req.params.messageId);
    if (!message) throw fail(404, "Message not found");
    const server = await messageAccess(message, req.user._id);
    if (
      String(message.author) !== String(req.user._id) &&
      (!message.channel ||
        !["owner", "admin"].includes(roleOf(server, req.user._id)))
    )
      throw fail(403, "Insufficient permissions");
    if (message.channel && !message.threadParent)
      await Message.deleteMany({ threadParent: message._id });
    await message.deleteOne();
    if (message.threadParent) {
      const newest = await Message.findOne({
        threadParent: message.threadParent,
      }).sort({ createdAt: -1 });
      await Message.updateOne(
        { _id: message.threadParent },
        {
          $inc: { threadCount: -1 },
          $set: { lastThreadReplyAt: newest?.createdAt || null },
        },
      );
      io.to(messageRoom(message)).emit("thread:changed", {
        parentId: String(message.threadParent),
        threadCount: await Message.countDocuments({
          threadParent: message.threadParent,
        }),
        lastThreadReplyAt: newest?.createdAt || null,
      });
    }
    io.to(messageRoom(message)).emit("message:deleted", {
      id: String(message._id),
      channelId: message.channel ? String(message.channel) : null,
      conversationId: message.conversation
        ? String(message.conversation)
        : null,
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/messages/:messageId/reactions",
  requireAuth,
  wrap(async (req, res) => {
    if (!validId(req.params.messageId)) throw fail(404, "Message not found");
    const message = await Message.findById(req.params.messageId);
    if (!message) throw fail(404, "Message not found");
    await messageAccess(message, req.user._id);
    const emoji = req.body.emoji;
    if (!["👍", "❤️", "😂", "🎉", "😮", "👀"].includes(emoji))
      throw fail(400, "Invalid reaction");
    let reaction = message.reactions.find((item) => item.emoji === emoji);
    if (!reaction) {
      message.reactions.push({ emoji, users: [] });
      reaction = message.reactions[message.reactions.length - 1];
    }
    const index = reaction.users.findIndex(
      (id) => String(id) === String(req.user._id),
    );
    if (index === -1) reaction.users.push(req.user._id);
    else reaction.users.splice(index, 1);
    message.reactions = message.reactions.filter((item) => item.users.length);
    await message.save();
    const payload = {
      id: String(message._id),
      reactions: reactionsView(message),
    };
    io.to(messageRoom(message)).emit("message:reactions", payload);
    res.json(payload);
  }),
);

io.use(async (socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie || "";
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("token="))
      ?.slice(6);
    const id = tokenUser(token);
    if (!validId(id)) return next(new Error("Unauthorized"));
    const user = await User.findById(id).select("name");
    if (!user) return next(new Error("Unauthorized"));
    socket.data.userId = id;
    socket.data.userName = user.name;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", async (socket) => {
  const userId = socket.data.userId;
  socket.join(`user:${userId}`);
  socket.on("channel:join", async (channelId, ack = () => {}) => {
    try {
      await memberChannel(channelId, userId);
      for (const room of socket.rooms)
        if (room.startsWith("channel:")) socket.leave(room);
      socket.join(`channel:${channelId}`);
      ack({ ok: true });
    } catch (error) {
      ack({ error: error.message });
    }
  });
  socket.on("dm:join", async (conversationId, ack = () => {}) => {
    try {
      await memberConversation(conversationId, userId);
      socket.join(`dm:${conversationId}`);
      ack({ ok: true });
    } catch (error) {
      ack({ error: error.message });
    }
  });
  socket.on("message:send", async (payload, ack = () => {}) => {
    try {
      const channelId = payload?.channelId || null;
      const conversationId = payload?.conversationId || null;
      if (Boolean(channelId) === Boolean(conversationId))
        throw fail(400, "Choose a channel or DM");
      const channel = channelId ? await memberChannel(channelId, userId) : null;
      const conversation = conversationId
        ? await memberConversation(conversationId, userId)
        : null;
      const threadParentId = payload?.threadParent || null;
      if (threadParentId && (!channel || !validId(threadParentId)))
        throw fail(400, "Invalid thread");
      const threadParent = threadParentId
        ? await Message.findOne({
            _id: threadParentId,
            channel: channelId,
            threadParent: null,
          })
        : null;
      if (threadParentId && !threadParent) throw fail(404, "Thread not found");
      const replyToId = payload?.replyTo || null;
      if (replyToId && !validId(replyToId)) throw fail(400, "Invalid reply");
      const replyTarget = replyToId ? await Message.findById(replyToId) : null;
      if (
        replyToId &&
        (!replyTarget ||
          String(replyTarget.channel || "") !== String(channelId || "") ||
          String(replyTarget.conversation || "") !==
            String(conversationId || "") ||
          String(replyTarget.threadParent || "") !==
            String(threadParentId || ""))
      )
        throw fail(404, "Reply target not found");
      const content = clean(payload?.content, 2000);
      const imageUrl = payload?.imageUrl || null;
      if ((!content && !imageUrl) || content.length > 2000)
        throw fail(400, "Message must have text or an image");
      if (imageUrl && !(await validCloudinaryImage(imageUrl, userId)))
        throw fail(400, "Invalid image");
      const mentions = await mentionIds(content, channel, conversation);
      const message = await Message.create({
        channel: channelId,
        conversation: conversationId,
        author: userId,
        content,
        imageUrl,
        replyTo: replyToId,
        threadParent: threadParentId,
        mentions,
      });
      if (threadParent)
        await Message.updateOne(
          { _id: threadParent._id },
          {
            $inc: { threadCount: 1 },
            $set: { lastThreadReplyAt: message.createdAt },
          },
        );
      await message.populate([
        { path: "author", select: "name avatarUrl" },
        replyPopulate,
      ]);
      const view = messageView(message);
      io.to(messageRoom(message)).emit(
        threadParent ? "thread:reply" : "message:new",
        view,
      );
      if (threadParent)
        io.to(messageRoom(message)).emit("thread:changed", {
          parentId: String(threadParent._id),
          threadCount: threadParent.threadCount + 1,
          lastThreadReplyAt: message.createdAt,
        });
      if (channel)
        io.to(`server:${channel.server}`).emit("unread:changed", { channelId });
      if (conversation) {
        await Conversation.updateOne(
          { _id: conversation._id },
          { $set: { updatedAt: new Date() } },
        );
        for (const id of conversation.members)
          io.to(`user:${id}`).emit("unread:changed", { conversationId });
      }
      await sendNotifications(
        message,
        channel,
        conversation,
        replyTarget || threadParent,
      );
      ack({ ok: true, message: view });
    } catch (error) {
      ack({ error: error.message });
    }
  });
  socket.on("typing", async (payload) => {
    try {
      const channelId = payload?.channelId || null;
      const conversationId = payload?.conversationId || null;
      if (Boolean(channelId) === Boolean(conversationId)) return;
      if (channelId) await memberChannel(channelId, userId);
      else await memberConversation(conversationId, userId);
      const room = channelId ? `channel:${channelId}` : `dm:${conversationId}`;
      if (!socket.rooms.has(room)) return;
      socket
        .to(room)
        .emit("typing", {
          channelId,
          conversationId,
          userId,
          name: socket.data.userName,
          active: Boolean(payload?.active),
        });
    } catch {
      /* Ignore invalid typing events. */
    }
  });
  socket.on("disconnecting", () => {
    const serverIds = [...socket.rooms]
      .filter((room) => room.startsWith("server:"))
      .map((room) => room.slice(7));
    setTimeout(() => serverIds.forEach(emitPresence), 0);
  });
  try {
    const servers = await Server.find({ members: userId }).select("_id");
    const conversations = await Conversation.find({ members: userId }).select(
      "_id",
    );
    for (const server of servers) socket.join(`server:${server._id}`);
    for (const conversation of conversations)
      socket.join(`dm:${conversation._id}`);
    for (const server of servers) emitPresence(server._id);
  } catch {
    socket.disconnect();
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
if (production) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/(?:api|socket\.io)(?:\/|$)).*/, (_req, res) =>
    res.sendFile(path.join(clientDist, "index.html")),
  );
}

app.use((error, _req, res, _next) => {
  if (error?.code === 11000)
    return res.status(409).json({ error: "Already exists" });
  if (error?.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "Image must be at most 5 MB" });
  if (error?.type === "entity.too.large")
    return res.status(413).json({ error: "Image must be at most 5 MB" });
  if (error instanceof SyntaxError && "body" in error)
    return res.status(400).json({ error: "Invalid JSON" });
  if (!error.status || error.status >= 500) console.error(error);
  res
    .status(error.status || 500)
    .json({ error: error.status ? error.message : "Server error" });
});

await mongoose.connect(MONGODB_URI);
httpServer.listen(Number(PORT), () =>
  console.log(`API listening on http://localhost:${PORT}`),
);
