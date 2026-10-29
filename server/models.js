import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const User = model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  avatarUrl: { type: String, default: null },
  notificationsEnabled: { type: Boolean, default: false },
  lastReadChannels: { type: Map, of: Date, default: {} },
  lastReadDms: { type: Map, of: Date, default: {} }
}, { timestamps: true }));

export const Server = model('Server', new Schema({
  name: { type: String, required: true, trim: true },
  inviteCode: { type: String, required: true, unique: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  admins: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true }));

export const Channel = model('Channel', new Schema({
  server: { type: Schema.Types.ObjectId, ref: 'Server', required: true, index: true },
  name: { type: String, required: true, trim: true }
}, { timestamps: true }));

export const Conversation = model('Conversation', new Schema({
  members: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
  pairKey: { type: String, unique: true, required: true }
}, { timestamps: true }));

const messageSchema = new Schema({
  channel: { type: Schema.Types.ObjectId, ref: 'Channel', default: null, index: true },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null, index: true },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '', trim: true },
  imageUrl: { type: String, default: null },
  reactions: [{ emoji: String, users: [{ type: Schema.Types.ObjectId, ref: 'User' }] }],
  editedAt: { type: Date, default: null },
  replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  threadParent: { type: Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
  threadCount: { type: Number, default: 0 },
  lastThreadReplyAt: { type: Date, default: null },
  mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

messageSchema.index({ channel: 1, createdAt: -1, _id: -1 });
messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
messageSchema.index({ content: 'text' });
export const Message = model('Message', messageSchema);
