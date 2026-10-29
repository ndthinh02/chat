export type User = { id: string; name: string; email: string; avatarUrl: string | null; notificationsEnabled?: boolean; role?: 'owner' | 'admin' | 'member' };
export type Community = { id: string; name: string; inviteCode: string; ownerId: string; adminIds: string[]; memberCount: number };
export type Channel = { id: string; serverId: string; name: string };
export type Conversation = { id: string; otherUser: User };
export type Message = { id: string; channelId: string | null; conversationId: string | null; author: { id: string; name: string; avatarUrl: string | null }; content: string; imageUrl: string | null; reactions: { emoji: string; userIds: string[] }[]; createdAt: string; editedAt: string | null; replyTo: string | null; replyPreview: { author: string; content: string } | null; threadParent: string | null; threadCount: number; lastThreadReplyAt: string | null; mentions: string[] };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export async function uploadImage(path: string, file: File): Promise<{ imageUrl?: string; user?: User }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image up to 5 MB');
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
