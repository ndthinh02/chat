import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ArrowDown, ArrowLeft, Check, ChevronDown, Copy, Hash, ImagePlus, LogOut, Menu, MessageCircle, MoreHorizontal, Pencil, Plus, Search, Send, Smile, Trash2, Users, X } from 'lucide-react';
import { api, post, uploadImage, type Channel, type Community, type Conversation, type Message, type User } from './api';

type Dialog = 'createServer' | 'joinServer' | 'createChannel' | 'invite' | 'newDm' | 'profile' | null;
type AuthMode = 'login' | 'register';
const emojis = ['👍', '❤️', '😂', '🎉', '😮', '👀'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
const time = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (date: string) => new Date(date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
const mentionText = (content: string, me: User) => content.split(/(@[\p{L}\p{N}_]+)/gu).map((part, index) => part.startsWith('@') ? <mark key={index} className={part.slice(1).toLowerCase() === me.name.trim().replace(/[^\p{L}\p{N}_]+/gu, '_').toLowerCase() ? 'mention mine' : 'mention'}>{part}</mark> : part);
function Avatar({ name, url, className = '' }: { name: string; url?: string | null; className?: string }) {
  return <div className={className}>{url ? <img src={url} alt=""/> : initials(name)}</div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [servers, setServers] = useState<Community[]>([]);
  const [serverId, setServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadChannels, setUnreadChannels] = useState<Record<string, number>>({});
  const [unreadDms, setUnreadDms] = useState<Record<string, number>>({});
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<User[]>([]);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reactionMenuId, setReactionMenuId] = useState<string | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const [threadDraft, setThreadDraft] = useState('');
  const [threadReplyTo, setThreadReplyTo] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<(Message & { location: string })[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchMore, setSearchMore] = useState(false);
  const [jumpId, setJumpId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageLoadRef = useRef(false);
  const threadRef = useRef<string | null>(null);
  const pendingChannelRef = useRef<string | null>(null);
  const pendingThreadRef = useRef<{ parent: Message; replyId: string } | null>(null);
  const userRef = useRef<User | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);

  const selectedServer = servers.find((server) => server.id === serverId);
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const selectedConversation = conversations.find((conversation) => conversation.id === conversationId);
  const myRole = selectedServer ? selectedServer.ownerId === user?.id ? 'owner' : selectedServer.adminIds?.includes(user?.id || '') ? 'admin' : 'member' : 'member';
  const canManage = myRole === 'owner' || myRole === 'admin';

  useEffect(() => {
    api<{ user: User }>('/auth/me').then(({ user }) => setUser(user)).catch(() => {}).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (dialog !== 'newDm' || userSearch.trim().length < 2) { setUserResults([]); return; }
    const timer = setTimeout(() => api<{ users: User[] }>(`/users?query=${encodeURIComponent(userSearch.trim())}`).then((data) => setUserResults(data.users)).catch(() => setUserResults([])), 250);
    return () => clearTimeout(timer);
  }, [dialog, userSearch]);

  const loadServers = useCallback(async () => {
    const { servers } = await api<{ servers: Community[] }>('/servers');
    setServers(servers);
    setServerId((current) => conversationRef.current ? null : current && servers.some((server) => server.id === current) ? current : servers[0]?.id ?? null);
  }, []);
  useEffect(() => { if (user) loadServers().catch((e) => setError(e.message)); }, [user, loadServers]);
  const loadConversations = useCallback(async () => {
    const { conversations } = await api<{ conversations: Conversation[] }>('/dms');
    setConversations(conversations);
  }, []);
  const loadUnread = useCallback(async () => {
    const counts = await api<{ channels: Record<string, number>; dms: Record<string, number> }>('/unread');
    setUnreadChannels(counts.channels); setUnreadDms(counts.dms);
  }, []);
  useEffect(() => { if (user) { loadConversations().catch(() => {}); loadUnread().catch(() => {}); } }, [user, loadConversations, loadUnread]);

  useEffect(() => {
    if (!user) return;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on('connect', () => { if (channelRef.current) socket.emit('channel:join', channelRef.current); if (conversationRef.current) socket.emit('dm:join', conversationRef.current); });
    socket.on('message:new', (message: Message) => {
      if (message.threadParent) return;
      if (!((message.channelId && message.channelId === channelRef.current) || (message.conversationId && message.conversationId === conversationRef.current))) return;
      const nearBottom = scrollRef.current ? scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 140 : true;
      setMessages((old) => old.some((item) => item.id === message.id) ? old : [...old, message]);
      if (nearBottom) requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
      const path = message.channelId ? `/channels/${message.channelId}` : `/dms/${message.conversationId}`;
      if (document.hasFocus()) post(`${path}/read`).then(() => {
        if (message.channelId) setUnreadChannels((old) => ({ ...old, [message.channelId!]: 0 }));
        if (message.conversationId) setUnreadDms((old) => ({ ...old, [message.conversationId!]: 0 }));
      }).catch(() => {});
    });
    socket.on('message:updated', (message: Message) => { setMessages((old) => old.map((item) => item.id === message.id ? message : item)); setThreadReplies((old) => old.map((item) => item.id === message.id ? message : item)); });
    socket.on('message:deleted', ({ id }: { id: string }) => { setMessages((old) => old.filter((item) => item.id !== id).map((item) => item.replyTo === id ? { ...item, replyPreview: null } : item)); setThreadReplies((old) => old.filter((item) => item.id !== id).map((item) => item.replyTo === id ? { ...item, replyPreview: null } : item)); });
    socket.on('thread:reply', (message: Message) => { if (message.threadParent === threadRef.current) { setThreadReplies((old) => old.some((item) => item.id === message.id) ? old : [...old, message]); if (document.hasFocus()) post(`/messages/${threadRef.current}/thread/read`).then(() => loadUnread()).catch(() => {}); } });
    socket.on('thread:changed', ({ parentId, threadCount, lastThreadReplyAt }: { parentId: string; threadCount: number; lastThreadReplyAt: string | null }) => { setMessages((old) => old.map((item) => item.id === parentId ? { ...item, threadCount, lastThreadReplyAt } : item)); setThreadParent((old) => old?.id === parentId ? { ...old, threadCount, lastThreadReplyAt } : old); });
    socket.on('notification:new', ({ message, kind, serverId: targetServer }: { message: Message; kind: string; serverId: string | null }) => {
      if (document.hasFocus() || !userRef.current?.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
      const note = new Notification(kind === 'dm' ? `DM from ${message.author.name}` : kind === 'mention' ? `${message.author.name} mentioned you` : `${message.author.name} replied to you`, { body: message.content.slice(0, 120) || 'Image' });
      note.onclick = () => { window.focus(); jumpToMessage(message, targetServer); note.close(); };
    });
    socket.on('message:reactions', ({ id, reactions }: { id: string; reactions: Message['reactions'] }) => setMessages((old) => old.map((item) => item.id === id ? { ...item, reactions } : item)));
    socket.on('channel:created', (channel: Channel) => setChannels((old) => channel.serverId === serverId && !old.some((item) => item.id === channel.id) ? [...old, channel] : old));
    socket.on('channel:deleted', ({ channelId: id }: { channelId: string }) => { setChannels((old) => old.filter((item) => item.id !== id)); if (channelRef.current === id) setChannelId(null); });
    socket.on('server:kicked', ({ serverId: id }: { serverId: string }) => { setServers((old) => old.filter((item) => item.id !== id)); setServerId((current) => current === id ? null : current); setError('You were removed from a server'); });
    socket.on('server:deleted', ({ serverId: id }: { serverId: string }) => { setServers((old) => old.filter((item) => item.id !== id)); setServerId((current) => current === id ? null : current); });
    socket.on('dm:created', () => { loadConversations().catch(() => {}); loadUnread().catch(() => {}); });
    socket.on('unread:changed', (change: { conversationId?: string }) => { loadUnread().catch(() => {}); if (change?.conversationId) loadConversations().catch(() => {}); });
    socket.on('profile:updated', (profile: { id: string; name: string; avatarUrl: string | null }) => {
      setUser((current) => current?.id === profile.id ? { ...current, ...profile } : current);
      setMembers((old) => old.map((member) => member.id === profile.id ? { ...member, ...profile } : member));
      setConversations((old) => old.map((conversation) => conversation.otherUser.id === profile.id ? { ...conversation, otherUser: { ...conversation.otherUser, ...profile } } : conversation));
      setMessages((old) => old.map((message) => message.author.id === profile.id ? { ...message, author: { ...message.author, ...profile } } : message));
    });
    socket.on('presence', ({ serverId: id, userIds }: { serverId: string; userIds: string[] }) => { if (id === serverId) setOnlineIds(userIds); });
    socket.on('members:changed', ({ serverId: id }: { serverId: string }) => {
      if (id === serverId) {
        api<{ members: User[]; onlineIds: string[] }>(`/servers/${id}/members`).then((data) => { setMembers(data.members); setOnlineIds(data.onlineIds); }).catch(() => {});
        loadServers().catch(() => {});
      }
    });
    socket.on('typing', ({ channelId: id, conversationId: dmId, userId, name, active }: { channelId: string | null; conversationId: string | null; userId: string; name: string; active: boolean }) => {
      if (!((id && id === channelRef.current) || (dmId && dmId === conversationRef.current))) return;
      setTyping((old) => { const next = { ...old }; if (active) next[userId] = name; else delete next[userId]; return next; });
      if (active) setTimeout(() => setTyping((old) => { const next = { ...old }; delete next[userId]; return next; }), 3200);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user?.id, serverId, loadServers, loadConversations, loadUnread]);

  useEffect(() => {
    setChannels([]); setChannelId(pendingChannelRef.current); setMembers([]); setOnlineIds([]); setMobileSidebar(false);
    if (!serverId) return;
    let cancelled = false;
    Promise.all([
      api<{ channels: Channel[] }>(`/servers/${serverId}/channels`),
      api<{ members: User[]; onlineIds: string[] }>(`/servers/${serverId}/members`)
    ]).then(([channelData, memberData]) => {
      if (cancelled) return;
      setChannels(channelData.channels); setChannelId((current) => current && channelData.channels.some((item) => item.id === current) ? current : channelData.channels[0]?.id ?? null); pendingChannelRef.current = null;
      setMembers(memberData.members); setOnlineIds(memberData.onlineIds);
    }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [serverId]);

  useEffect(() => {
    channelRef.current = channelId;
    conversationRef.current = conversationId;
    setMessages([]); setHasMore(false); setTyping({}); setDraft(''); setAttachedFile(null); setEditingId(null); setReplyingTo(null); setThreadParent(null); setThreadReplies([]); setThreadReplyTo(null); threadRef.current = null;
    if (!channelId && !conversationId) return;
    let cancelled = false;
    setLoadingMessages(true);
    const path = channelId ? `/channels/${channelId}` : `/dms/${conversationId}`;
    const target = jumpId;
    api<{ messages: Message[]; hasMore: boolean }>(`${path}/messages${target ? `?around=${target}` : ''}`).then((data) => {
      if (cancelled) return;
      setMessages(data.messages); setHasMore(data.hasMore);
      requestAnimationFrame(() => target ? document.getElementById(`message-${target}`)?.scrollIntoView({ block: 'center' }) : scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
      if (pendingThreadRef.current?.parent.id === target) {
        const pending = pendingThreadRef.current; pendingThreadRef.current = null;
        openThread(pending.parent).then(() => setTimeout(() => document.getElementById(`thread-message-${pending.replyId}`)?.scrollIntoView({ block: 'center' }), 100));
      }
    }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoadingMessages(false); });
    if (channelId && socketRef.current?.connected) socketRef.current.emit('channel:join', channelId);
    if (conversationId && socketRef.current?.connected) socketRef.current.emit('dm:join', conversationId);
    post(`${path}/read`).then(() => {
      if (channelId) setUnreadChannels((old) => ({ ...old, [channelId]: 0 }));
      if (conversationId) setUnreadDms((old) => ({ ...old, [conversationId]: 0 }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [channelId, conversationId, jumpId]);

  async function loadOlder() {
    if ((!channelId && !conversationId) || !hasMore || loadingMessages || messageLoadRef.current || !messages.length) return;
    messageLoadRef.current = true;
    const el = scrollRef.current;
    const previousHeight = el?.scrollHeight || 0;
    try {
      const path = channelId ? `/channels/${channelId}` : `/dms/${conversationId}`;
      const data = await api<{ messages: Message[]; hasMore: boolean }>(`${path}/messages?before=${messages[0].id}`);
      if (channelRef.current !== channelId || conversationRef.current !== conversationId) return;
      setMessages((old) => [...data.messages, ...old]); setHasMore(data.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - previousHeight; });
    } catch (e) { setError((e as Error).message); }
    finally { messageLoadRef.current = false; }
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { user } = await post<{ user: User }>(`/auth/${authMode}`, { name: authName, email: authEmail, password: authPassword });
      setUser(user); setAuthPassword('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    await post('/auth/logout'); socketRef.current?.disconnect(); setUser(null); setServers([]); setServerId(null); setChannelId(null); setMessages([]);
  }
  async function handleDialog(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (dialog === 'createServer') {
        const { server } = await post<{ server: Community }>('/servers', { name: dialogValue });
        setServers((old) => [...old, server]); setServerId(server.id);
      } else if (dialog === 'joinServer') {
        const { server } = await post<{ server: Community }>('/servers/join', { code: dialogValue });
        setServers((old) => old.some((item) => item.id === server.id) ? old : [...old, server]); setServerId(server.id);
      } else if (dialog === 'createChannel' && serverId) {
        const { channel } = await post<{ channel: Channel }>(`/servers/${serverId}/channels`, { name: dialogValue });
        setChannels((old) => old.some((item) => item.id === channel.id) ? old : [...old, channel]); setChannelId(channel.id);
      } else if (dialog === 'profile') {
        const { user: updated } = await api<{ user: User }>('/profile', { method: 'PATCH', body: JSON.stringify({ name: dialogValue }) });
        setUser(updated);
      }
      setDialog(null); setDialogValue('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function leaveServer() {
    if (!serverId || !confirm(`Leave ${selectedServer?.name}?`)) return;
    try { await post(`/servers/${serverId}/leave`); setServers((old) => old.filter((server) => server.id !== serverId)); setServerId(servers.find((server) => server.id !== serverId)?.id ?? null); }
    catch (e) { setError((e as Error).message); }
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && !attachedFile) || (!channelId && !conversationId) || !socketRef.current || uploading) return;
    setUploading(true);
    try {
      const imageUrl = attachedFile ? (await uploadImage('/uploads', attachedFile)).imageUrl : null;
      const target = channelId ? { channelId } : { conversationId };
      socketRef.current.emit('message:send', { ...target, content, imageUrl, replyTo: replyingTo?.id || null }, (result: { error?: string; message?: Message }) => {
        if (result?.error) { setError(result.error); setDraft(content); }
        else if (result?.message && ((channelId && channelRef.current === channelId) || (conversationId && conversationRef.current === conversationId))) setMessages((old) => old.some((item) => item.id === result.message!.id) ? old : [...old, result.message!]);
      });
      socketRef.current.emit('typing', { channelId, conversationId, active: false });
      setDraft(''); setAttachedFile(null); setReplyingTo(null);
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  }
  async function openThread(message: Message) {
    try {
      const { parent, replies } = await api<{ parent: Message; replies: Message[] }>(`/messages/${message.id}/thread`);
      threadRef.current = parent.id; setThreadParent(parent); setThreadReplies(replies); setThreadDraft(''); setThreadReplyTo(null);
      await post(`/messages/${parent.id}/thread/read`); loadUnread().catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }
  function jumpToMessage(message: Message, targetServer: string | null = serverId) {
    setSearchOpen(false);
    if (message.threadParent) {
      api<{ message: Message }>(`/messages/${message.threadParent}`).then(({ message: parent }) => {
        pendingThreadRef.current = { parent, replyId: message.id };
        jumpToMessage(parent, targetServer);
      }).catch((e) => setError(e.message));
      return;
    }
    if (message.channelId) { setConversationId(null); if (targetServer !== serverId) pendingChannelRef.current = message.channelId; setServerId(targetServer); setChannelId(message.channelId); }
    else { setServerId(null); setChannelId(null); setConversationId(message.conversationId); }
    if (jumpId === message.id && pendingThreadRef.current) {
      const pending = pendingThreadRef.current; pendingThreadRef.current = null;
      openThread(pending.parent).then(() => setTimeout(() => document.getElementById(`thread-message-${pending.replyId}`)?.scrollIntoView({ block: 'center' }), 100));
    }
    setJumpId(message.id);
    requestAnimationFrame(() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ block: 'center' }));
  }
  async function sendThreadReply(event: FormEvent) {
    event.preventDefault();
    if (!threadParent || !threadDraft.trim()) return;
    const content = threadDraft.trim(); setThreadDraft('');
    socketRef.current?.emit('message:send', { channelId: threadParent.channelId, threadParent: threadParent.id, replyTo: threadReplyTo?.id || null, content }, (result: { error?: string }) => { if (result?.error) { setError(result.error); setThreadDraft(content); } });
    setThreadReplyTo(null);
  }
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); setSearchMore(false); return; }
    const timer = setTimeout(() => api<{ results: (Message & { location: string })[]; hasMore: boolean }>(`/search?q=${encodeURIComponent(searchQuery.trim())}&page=${searchPage}${serverId ? `&serverId=${serverId}` : ''}`).then((data) => { setSearchResults((old) => searchPage === 1 ? data.results : [...old, ...data.results]); setSearchMore(data.hasMore); }).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(timer);
  }, [searchOpen, searchQuery, searchPage, serverId]);
  async function toggleNotifications() {
    try {
      if (!user?.notificationsEnabled && !('Notification' in window)) { setError('This browser does not support notifications'); return; }
      if (!user?.notificationsEnabled && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { setError('Allow notifications in your browser settings to turn them on'); return; }
      }
      const { user: updated } = await api<{ user: User }>('/profile/notifications', { method: 'PATCH', body: JSON.stringify({ enabled: !user?.notificationsEnabled }) });
      setUser(updated);
    } catch (e) { setError((e as Error).message); }
  }
  function changeDraft(value: string) {
    setDraft(value);
    if (!channelId && !conversationId) return;
    socketRef.current?.emit('typing', { channelId, conversationId, active: Boolean(value.trim()) });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current?.emit('typing', { channelId, conversationId, active: false }), 1800);
  }
  async function saveEdit(id: string) {
    try {
      const { message } = await api<{ message: Message }>(`/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ content: editValue }) });
      setMessages((old) => old.map((item) => item.id === id ? message : item)); setEditingId(null);
    } catch (e) { setError((e as Error).message); }
  }
  async function deleteMessage(id: string) {
    if (!confirm('Delete this message?')) return;
    try { await api(`/messages/${id}`, { method: 'DELETE' }); setMessages((old) => old.filter((item) => item.id !== id)); }
    catch (e) { setError((e as Error).message); }
    setMenuId(null);
  }
  async function toggleReaction(id: string, emoji: string) {
    try {
      const data = await post<{ id: string; reactions: Message['reactions'] }>(`/messages/${id}/reactions`, { emoji });
      setMessages((old) => old.map((item) => item.id === id ? { ...item, reactions: data.reactions } : item));
      setReactionMenuId(null);
    } catch (e) { setError((e as Error).message); }
  }
  async function openDm(other: User) {
    try {
      const { conversation } = await post<{ conversation: Conversation }>('/dms', { userId: other.id });
      setConversations((old) => [conversation, ...old.filter((item) => item.id !== conversation.id)]);
      conversationRef.current = conversation.id;
      setConversationId(conversation.id); setServerId(null); setChannelId(null); setDialog(null); setMobileSidebar(false);
    } catch (e) { setError((e as Error).message); }
  }
  async function changeRole(member: User, role: 'admin' | 'member') {
    if (!serverId) return;
    try {
      const { server } = await api<{ server: Community }>(`/servers/${serverId}/members/${member.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setServers((old) => old.map((item) => item.id === server.id ? server : item));
      setMembers((old) => old.map((item) => item.id === member.id ? { ...item, role } : item));
    } catch (e) { setError((e as Error).message); }
  }
  async function kickMember(member: User) {
    if (!serverId || !confirm(`Remove ${member.name} from ${selectedServer?.name}?`)) return;
    try { await api(`/servers/${serverId}/members/${member.id}`, { method: 'DELETE' }); setMembers((old) => old.filter((item) => item.id !== member.id)); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteChannel(channel: Channel) {
    if (!serverId || !confirm(`Delete #${channel.name} and its messages?`)) return;
    try { await api(`/servers/${serverId}/channels/${channel.id}`, { method: 'DELETE' }); setChannels((old) => old.filter((item) => item.id !== channel.id)); if (channelId === channel.id) setChannelId(null); }
    catch (e) { setError((e as Error).message); }
  }
  async function deleteServer() {
    if (!serverId || !confirm(`Delete ${selectedServer?.name} and all its channels?`)) return;
    try { await api(`/servers/${serverId}`, { method: 'DELETE' }); setServers((old) => old.filter((item) => item.id !== serverId)); setServerId(null); }
    catch (e) { setError((e as Error).message); }
  }
  async function uploadAvatar(file: File) {
    try { const { user: updated } = await uploadImage('/profile/avatar', file); if (updated) setUser(updated); }
    catch (e) { setError((e as Error).message); }
  }
  function openDialog(type: Dialog) { setDialog(type); setDialogValue(type === 'profile' ? user?.name || '' : ''); setUserSearch(''); setError(''); setCopied(false); }

  if (checking) return <div className="loading-screen"><div className="brand-mark"><MessageCircle size={27}/></div></div>;
  if (!user) return <div className="auth-page">
    <div className="auth-glow"/>
    <div className="auth-wrap">
      <div className="auth-intro"><div className="brand-lockup"><div className="brand-mark"><MessageCircle size={25}/></div><span>gather<span className="brand-dot">.</span></span></div><h1>A place for your<br/><em>people.</em></h1><p>Good conversations deserve a home. Bring your community together, one message at a time.</p><div className="auth-decoration"><span className="decoration-avatar a1">A</span><span className="decoration-avatar a2">M</span><span className="decoration-avatar a3">J</span><span>Make room for everyone.</span></div></div>
      <div className="auth-card"><div className="auth-card-top"><span className="eyebrow">WELCOME TO GATHER</span><h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{authMode === 'login' ? 'Sign in to pick up where you left off.' : 'Join the conversation in a few steps.'}</p></div>
        <form onSubmit={handleAuth} className="auth-form">{authMode === 'register' && <label>Your name<input autoComplete="name" value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="e.g. Alex Morgan" required minLength={2} maxLength={32}/></label>}<label>Email address<input type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" required/></label><label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="At least 8 characters" required minLength={authMode === 'register' ? 8 : undefined}/></label>{error && <div className="error-box">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'} <span>→</span></button></form>
        <div className="auth-switch">{authMode === 'login' ? 'New around here?' : 'Already have an account?'} <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></div>
      </div>
    </div>
  </div>;

  return <div className="app-shell">
    <aside className="server-rail">
      <button className="rail-brand" title="Gather"><MessageCircle size={25}/></button>
      <div className="rail-divider"/>
      {servers.map((server) => <button key={server.id} onClick={() => { setConversationId(null); setServerId(server.id); }} title={server.name} className={`server-tile ${serverId === server.id ? 'active' : ''}`}>{initials(server.name)}</button>)}
      <div className="rail-divider"/>
      <button title="Create server" onClick={() => openDialog('createServer')} className="rail-add"><Plus size={23}/></button>
      <button title="Join server" onClick={() => openDialog('joinServer')} className="rail-add join-rail">↗</button>
      <div className="rail-spacer"/>
      <button className="rail-profile-button" onClick={() => openDialog('profile')} title="Edit profile"><Avatar className="rail-user" name={user.name} url={user.avatarUrl}/></button>
    </aside>
    <aside className={`channel-sidebar ${mobileSidebar ? 'mobile-open' : ''}`}>
      <div className="server-header"><div><span className="sidebar-caption">YOUR SPACE</span><h2>{selectedServer?.name || 'Direct messages'}</h2></div>{selectedServer && <ChevronDown size={17}/>}</div>
      <div className="sidebar-scroll">
        {selectedServer && <>
          <div className="sidebar-section"><span>TEXT CHANNELS</span>{canManage && <button title="Create channel" onClick={() => openDialog('createChannel')}><Plus size={17}/></button>}</div>
          <nav className="channel-list">{channels.map((channel) => <div className={`channel-line ${channel.id === channelId ? 'selected' : ''}`} key={channel.id}>
            <button onClick={() => { setConversationId(null); setChannelId(channel.id); setMobileSidebar(false); }} className="channel-item"><Hash size={18}/><span>{channel.name}</span>{!!unreadChannels[channel.id] && channel.id !== channelId && <b className="unread-badge">{unreadChannels[channel.id]}</b>}</button>
            {canManage && <button className="channel-delete" title={`Delete ${channel.name}`} onClick={() => deleteChannel(channel)}><X size={14}/></button>}
          </div>)}</nav>
          <div className="sidebar-section sidebar-section-lower"><span>YOUR COMMUNITY</span></div>
          <button className="sidebar-action" onClick={() => openDialog('invite')}><Copy size={16}/> Invite people</button>
          <button className="sidebar-action" onClick={leaveServer}><ArrowLeft size={16}/> Leave server</button>
          {myRole === 'owner' && <button className="sidebar-action danger-action" onClick={deleteServer}><Trash2 size={16}/> Delete server</button>}
        </>}
        <div className="sidebar-section sidebar-section-lower dm-section"><span>DIRECT MESSAGES</span><button title="New direct message" onClick={() => openDialog('newDm')}><Plus size={17}/></button></div>
        <nav className="dm-list">{conversations.map((conversation) => <button key={conversation.id} className={`dm-item ${conversation.id === conversationId ? 'selected' : ''}`} onClick={() => { conversationRef.current = conversation.id; setConversationId(conversation.id); setServerId(null); setChannelId(null); setMobileSidebar(false); }}><Avatar className="dm-avatar" name={conversation.otherUser.name} url={conversation.otherUser.avatarUrl}/><span>{conversation.otherUser.name}</span>{!!unreadDms[conversation.id] && conversation.id !== conversationId && <b className="unread-badge">{unreadDms[conversation.id]}</b>}</button>)}</nav>
      </div>
      <div className="profile-bar"><button className="profile-edit" onClick={() => openDialog('profile')} title="Edit profile"><Avatar className="profile-avatar" name={user.name} url={user.avatarUrl}/></button><div className="profile-text"><strong>{user.name}</strong><span>Online</span></div><button title="Log out" onClick={logout}><LogOut size={18}/></button></div>
    </aside>
    <main className="main-panel">
      <header className="chat-header"><div className="header-title"><button className="mobile-menu" onClick={() => setMobileSidebar(!mobileSidebar)} aria-label="Toggle channels"><Menu size={21}/></button>{selectedConversation ? <MessageCircle size={20} className="header-hash"/> : <Hash size={22} className="header-hash"/>}<div><strong>{selectedConversation?.otherUser.name || selectedChannel?.name || (selectedServer ? 'No channel yet' : 'Your conversations')}</strong><span>{selectedConversation ? 'Direct message' : selectedChannel ? `A place for everything ${selectedChannel.name}` : 'Choose a space to get started'}</span></div></div><div className="header-tools"><button title="Search messages" className="header-icon" onClick={() => { setSearchOpen(!searchOpen); setSearchPage(1); }}><Search size={19}/></button>{selectedServer && <button title="Toggle members" className={`header-icon ${showMembers ? 'is-active' : ''}`} onClick={() => setShowMembers(!showMembers)}><Users size={20}/></button>}</div></header>
      {searchOpen && <section className="message-search"><div className="search-box"><Search size={17}/><input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchPage(1); }} placeholder="Search messages"/><button onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={16}/></button></div><div className="search-results">{searchResults.map((result) => <button key={result.id} onClick={() => jumpToMessage(result)}><strong>{result.location}</strong> · {result.author.name} · {day(result.createdAt)} {time(result.createdAt)}<span>{result.content.slice(0, 150) || 'Image'}</span></button>)}{searchQuery.trim().length >= 2 && !searchResults.length && <p>No messages found.</p>}{searchMore && <button className="search-more" onClick={() => setSearchPage((page) => page + 1)}>More results</button>}</div></section>}
      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
      {(selectedChannel || selectedConversation) ? <>
        <div className="message-scroll" ref={scrollRef} onScroll={(event) => { if (event.currentTarget.scrollTop < 80) loadOlder(); }}><div className="message-container">
          {hasMore && <button className="load-older" onClick={loadOlder}>{loadingMessages ? 'Loading…' : <><ArrowDown size={14} className="rotate-180"/> Load older messages</>}</button>}
          {!loadingMessages && messages.length === 0 && <div className="channel-welcome"><div className="welcome-hash">{selectedConversation ? <MessageCircle size={30}/> : <Hash size={31}/>}</div><h2>{selectedConversation ? `Say hello to ${selectedConversation.otherUser.name}` : `Welcome to #${selectedChannel?.name}`}</h2><p>This is the beginning of your conversation.</p></div>}
          {messages.map((message, index) => <div key={message.id}>
            {(index === 0 || day(messages[index - 1].createdAt) !== day(message.createdAt)) && <div className="date-divider"><span>{day(message.createdAt)}</span></div>}
            <div id={`message-${message.id}`} className={`message-row ${jumpId === message.id ? 'jump-highlight' : ''}`}><Avatar className="message-avatar" name={message.author.name} url={message.author.avatarUrl}/><div className="message-body"><div className="message-meta"><strong>{message.author.name}</strong><time>{time(message.createdAt)}</time>{message.editedAt && <span className="edited-tag">(edited)</span>}</div>
              {message.replyTo && <button className="reply-preview" onClick={() => { const original = messages.find((item) => item.id === message.replyTo); if (original) jumpToMessage(original); else api<{ message: Message }>(`/messages/${message.replyTo}`).then(({ message: found }) => jumpToMessage(found)).catch(() => setError('Original message deleted')); }}>{message.replyPreview ? <><strong>{message.replyPreview.author}</strong> {message.replyPreview.content.slice(0, 90)}</> : 'Original message deleted'}</button>}
              {editingId === message.id ? <form className="edit-form" onSubmit={(event) => { event.preventDefault(); saveEdit(message.id); }}><input autoFocus value={editValue} maxLength={2000} onChange={(event) => setEditValue(event.target.value)}/><div><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button type="submit">Save</button></div></form> : <>{message.content && <p>{mentionText(message.content, user)}</p>}{message.imageUrl && <a href={message.imageUrl} target="_blank" rel="noreferrer"><img className="message-image" src={message.imageUrl} alt="Message attachment"/></a>}</>}
              {message.channelId && message.threadCount > 0 && <button className="thread-link" onClick={() => openThread(message)}>{message.threadCount} {message.threadCount === 1 ? 'reply' : 'replies'} · {message.lastThreadReplyAt && time(message.lastThreadReplyAt)}</button>}
              {!!message.reactions.length && <div className="reaction-list">{message.reactions.map((reaction) => <button key={reaction.emoji} onClick={() => toggleReaction(message.id, reaction.emoji)} className={reaction.userIds.includes(user.id) ? 'mine' : ''}>{reaction.emoji} <span>{reaction.userIds.length}</span></button>)}</div>}
            </div><div className="message-actions"><button aria-label="Reply" title="Reply" onClick={() => setReplyingTo(message)}><MessageCircle size={16}/></button>{message.channelId && <button aria-label="Open thread" title="Open thread" onClick={() => openThread(message)}><Users size={16}/></button>}<button aria-label="Add reaction" onClick={() => { setReactionMenuId(reactionMenuId === message.id ? null : message.id); setMenuId(null); }}><Smile size={17}/></button>{(message.author.id === user.id || (message.channelId && canManage)) && <button aria-label="Message options" onClick={() => { setMenuId(menuId === message.id ? null : message.id); setReactionMenuId(null); }}><MoreHorizontal size={19}/></button>}
              {reactionMenuId === message.id && <div className="reaction-picker">{emojis.map((emoji) => <button key={emoji} onClick={() => toggleReaction(message.id, emoji)}>{emoji}</button>)}</div>}
              {menuId === message.id && <div className="message-menu">{message.author.id === user.id && <button onClick={() => { setEditingId(message.id); setEditValue(message.content); setMenuId(null); }}><Pencil size={14}/> Edit</button>}<button onClick={() => deleteMessage(message.id)}><Trash2 size={14}/> Delete</button></div>}
            </div></div>
          </div>)}
        </div></div>
        <div className="composer-wrap"><div className="typing-line">{Object.values(typing).length ? <><span className="typing-dots"><i/><i/><i/></span>{Object.values(typing).slice(0, 2).join(', ')} {Object.values(typing).length === 1 ? 'is' : 'are'} typing…</> : null}</div>{replyingTo && <div className="replying-bar">Replying to {replyingTo.author.name}: {replyingTo.content.slice(0, 80)}<button onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={15}/></button></div>}{attachedFile && <div className="attachment-chip"><ImagePlus size={15}/><span>{attachedFile.name}</span><button onClick={() => setAttachedFile(null)} aria-label="Remove image"><X size={15}/></button></div>}<form className="composer" onSubmit={sendMessage}><label className="attach-button" title="Attach image"><ImagePlus size={19}/><input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => setAttachedFile(event.target.files?.[0] || null)}/></label><input value={draft} onChange={(event) => changeDraft(event.target.value)} placeholder={selectedConversation ? `Message ${selectedConversation.otherUser.name}` : `Message #${selectedChannel?.name}`} maxLength={2000} aria-label="Message"/><button disabled={(!draft.trim() && !attachedFile) || uploading} title="Send message"><Send size={18}/></button></form><div className="composer-hint">{uploading ? 'Uploading image…' : 'Images: JPG, PNG, WebP, up to 5 MB'}</div></div>
      </> : <div className="empty-main"><div className="empty-icon"><MessageCircle size={36}/></div><h2>Good things start here.</h2><p>{selectedServer ? 'Choose a channel to get the conversation started.' : 'Create a server or start a direct message.'}</p><button className="primary-button" onClick={() => openDialog(selectedServer && canManage ? 'createChannel' : 'newDm')}>{selectedServer && canManage ? 'Create a channel' : 'New message'} <Plus size={18}/></button></div>}
    </main>
    {threadParent && <aside className="thread-panel"><div className="thread-header"><strong>Thread</strong><button onClick={() => { setThreadParent(null); setThreadReplies([]); threadRef.current = null; }} aria-label="Close thread"><X size={18}/></button></div><div className="thread-list"><div className="thread-message parent"><strong>{threadParent.author.name}</strong><time>{time(threadParent.createdAt)}</time><p>{mentionText(threadParent.content, user)}</p>{threadParent.imageUrl && <img className="message-image" src={threadParent.imageUrl} alt="Thread attachment"/>}</div><div className="thread-divider">{threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}</div>{threadReplies.map((reply) => <div className="thread-message" id={`thread-message-${reply.id}`} key={reply.id}><strong>{reply.author.name}</strong><time>{time(reply.createdAt)}</time>{reply.replyTo && <button className="reply-preview" onClick={() => { const target = threadReplies.find((item) => item.id === reply.replyTo); if (target) document.getElementById(`thread-message-${target.id}`)?.scrollIntoView({ block: 'center' }); }}>{reply.replyPreview ? `${reply.replyPreview.author}: ${reply.replyPreview.content.slice(0, 70)}` : 'Original message deleted'}</button>}<p>{mentionText(reply.content, user)}</p>{reply.imageUrl && <img className="message-image" src={reply.imageUrl} alt="Thread attachment"/>}<button className="thread-reply-action" onClick={() => setThreadReplyTo(reply)}>Reply</button></div>)}</div>{threadReplyTo && <div className="replying-bar">Replying to {threadReplyTo.author.name}: {threadReplyTo.content.slice(0, 60)}<button onClick={() => setThreadReplyTo(null)} aria-label="Cancel reply"><X size={14}/></button></div>}<form className="thread-composer" onSubmit={sendThreadReply}><input value={threadDraft} onChange={(event) => setThreadDraft(event.target.value)} maxLength={2000} placeholder="Reply in thread" aria-label="Thread reply"/><button disabled={!threadDraft.trim()}><Send size={17}/></button></form></aside>}
    {selectedServer && showMembers && <aside className="member-sidebar"><div className="member-heading"><span>MEMBERS</span><span>{members.length}</span></div>{[true, false].map((online) => <div key={String(online)}><div className={`member-section-title ${online ? '' : 'offline-title'}`}>{online ? 'ONLINE' : 'OFFLINE'} — {members.filter((member) => onlineIds.includes(member.id) === online).length}</div>{members.filter((member) => onlineIds.includes(member.id) === online).map((member) => <div className={`member-item ${online ? '' : 'offline'}`} key={member.id}><Avatar className="member-avatar" name={member.name} url={member.avatarUrl}/><button className="member-name" onClick={() => member.id !== user.id && openDm(member)}>{member.name}</button><span className="owner-badge">{member.role === 'owner' ? 'OWNER' : member.role === 'admin' ? 'ADMIN' : ''}</span>{canManage && member.id !== user.id && member.role !== 'owner' && <div className="member-controls">{myRole === 'owner' && <button title={member.role === 'admin' ? 'Remove admin' : 'Make admin'} onClick={() => changeRole(member, member.role === 'admin' ? 'member' : 'admin')}>{member.role === 'admin' ? '−A' : '+A'}</button>}{(myRole === 'owner' || member.role !== 'admin') && <button title="Kick member" onClick={() => kickMember(member)}><X size={13}/></button>}</div>}</div>)}</div>)}</aside>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="modal-card"><button className="modal-close" onClick={() => setDialog(null)} aria-label="Close"><X size={19}/></button><span className="eyebrow">{dialog === 'invite' ? 'GROW YOUR SPACE' : dialog === 'profile' ? 'YOUR IDENTITY' : 'MAKE IT YOURS'}</span><h2>{dialog === 'createServer' ? 'Create a server' : dialog === 'joinServer' ? 'Join a server' : dialog === 'createChannel' ? 'Create a channel' : dialog === 'newDm' ? 'New direct message' : dialog === 'profile' ? 'Your profile' : 'Invite your people'}</h2><p>{dialog === 'createServer' ? 'Give your community a name.' : dialog === 'joinServer' ? 'Enter the invite code shared by your community.' : dialog === 'createChannel' ? 'Give this conversation a clear name.' : dialog === 'newDm' ? 'Find someone by name or email.' : dialog === 'profile' ? 'Update how you appear in conversations.' : 'Share this code with people you want to bring in.'}</p>
      {dialog === 'invite' ? <div className="invite-box"><code>{selectedServer?.inviteCode}</code><button onClick={async () => { await navigator.clipboard.writeText(selectedServer?.inviteCode || ''); setCopied(true); }} title="Copy invite code">{copied ? <Check size={18}/> : <Copy size={18}/>}</button></div> : dialog === 'newDm' ? <><div className="search-box"><Search size={17}/><input autoFocus value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search people"/></div><div className="user-results">{userResults.map((result) => <button key={result.id} onClick={() => openDm(result)}><Avatar className="dm-avatar" name={result.name} url={result.avatarUrl}/><span><strong>{result.name}</strong><small>{result.email}</small></span></button>)}{userSearch.length >= 2 && !userResults.length && <p>No people found.</p>}</div></> : <form onSubmit={handleDialog}>{dialog === 'profile' && <label className="avatar-upload"><Avatar className="profile-preview" name={user.name} url={user.avatarUrl}/><span>Change avatar</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAvatar(file); }}/></label>}<label>{dialog === 'createServer' ? 'SERVER NAME' : dialog === 'joinServer' ? 'INVITE CODE' : dialog === 'profile' ? 'DISPLAY NAME' : 'CHANNEL NAME'}<input autoFocus value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} placeholder={dialog === 'createServer' ? 'e.g. The creative corner' : dialog === 'joinServer' ? 'Enter invite code' : dialog === 'profile' ? 'Your name' : 'e.g. ideas-and-feedback'} required maxLength={dialog === 'createServer' ? 48 : 32}/></label>{dialog === 'profile' && <div className="notification-setting"><span>Browser notifications</span><button type="button" onClick={toggleNotifications}>{user.notificationsEnabled ? 'On' : 'Off'}</button></div>}{error && <div className="error-box">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : dialog === 'joinServer' ? 'Join server' : dialog === 'profile' ? 'Save profile' : 'Create'} <span>→</span></button></form>}
    </div></div>}
  </div>;
}
