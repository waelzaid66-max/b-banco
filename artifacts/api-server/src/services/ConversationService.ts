import { db } from "@workspace/db";
import {
  conversations,
  messages,
  listings,
  listingMedia,
  users,
} from "@workspace/db/schema";
import { and, eq, or, desc, asc, ne, isNull, inArray, sql } from "drizzle-orm";
import { createNotification } from "./NotificationService";
import { checkMessageRate, checkConversationRate } from "./AbuseService";
import { publicVisibilityConditions } from "../lib/feedVisibility";
import { getObjectStorageService } from "../lib/objectStorageProvider";
import {
  assertCallerMayUseUpload,
  consumeUploadClaim,
  parseServingWildcard,
  servingWildcardToObjectPath,
} from "../lib/uploadClaims";

const objectStorageService = getObjectStorageService();

type CodedError = Error & { code?: string };
function codedError(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code });
}

export interface ConversationSummaryDTO {
  id: string;
  listing_id: string;
  listing_title: string | null;
  listing_thumb: string | null;
  counterparty_id: string;
  counterparty_name: string;
  last_message_text: string | null;
  last_message_at: string | null;
  unread: number;
  viewer_role: "buyer" | "seller";
}

/** Preview of the message a reply quotes. */
export interface MessageReplyPreview {
  id: string;
  body: string;
  sender_id: string;
}

/** A listing shared as a card inside the chat. */
export interface MessageListingRef {
  id: string;
  title: string | null;
  thumb: string | null;
  price: string | null;
}

export interface MessageDTO {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_mine: boolean;
  created_at: string;
  read_at: string | null;
  media_url: string | null;
  // Attachment kind: "image" | "video" | "audio" (voice note); null for text.
  media_kind: string | null;
  // Emoji reactions: count per emoji, + the emojis the viewer reacted with.
  reactions: Record<string, number>;
  my_reactions: string[];
  // Reply/quote target + shared-listing card (null when absent).
  reply_to: MessageReplyPreview | null;
  listing_ref: MessageListingRef | null;
}

// Allowlisted reaction emojis (prevents arbitrary/abusive payloads).
export const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🔥"] as const;

/** Reduce the stored reactions map ({emoji:[userId]}) to counts + the viewer's. */
function summarizeReactions(
  raw: unknown,
  viewerId: string
): { reactions: Record<string, number>; my_reactions: string[] } {
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [emoji, uids] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(uids) || uids.length === 0) continue;
      counts[emoji] = uids.length;
      if (uids.includes(viewerId)) mine.push(emoji);
    }
  }
  return { reactions: counts, my_reactions: mine };
}

async function getUserId(clerkId: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) throw codedError("UNAUTHORIZED", "User not found");
  return user.id;
}

/** Best single thumbnail per listing: prefer the flagged thumbnail, then lowest sort order. */
async function getThumbs(listingIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (listingIds.length === 0) return map;
  const media = await db
    .select({
      listingId: listingMedia.listingId,
      url: listingMedia.url,
      thumbnailUrl: listingMedia.thumbnailUrl,
    })
    .from(listingMedia)
    .where(inArray(listingMedia.listingId, listingIds))
    .orderBy(desc(listingMedia.isThumbnail), asc(listingMedia.sortOrder));
  for (const m of media) {
    if (!map.has(m.listingId)) {
      const t = m.thumbnailUrl ?? m.url;
      if (t) map.set(m.listingId, t);
    }
  }
  return map;
}

async function loadParticipantConversation(conversationId: string, userId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) throw codedError("NOT_FOUND", "Conversation not found");
  if (conv.buyerId !== userId && conv.sellerId !== userId) {
    throw codedError("UNAUTHORIZED", "Not a participant in this conversation");
  }
  return conv;
}

/**
 * Start a conversation on a listing, or return the existing one. The buyer is
 * the caller; the seller is the listing owner. The (listing, buyer, seller)
 * tuple is unique, so repeat calls are idempotent.
 */
export async function createConversation(
  clerkId: string,
  listingId: string,
  ip?: string
): Promise<ConversationSummaryDTO> {
  const buyerId = await getUserId(clerkId);

  // Conversation-creation rate cap: prevents bulk thread-opening spam directed
  // at sellers. This is a convenience-path guard (fails open on counter outage)
  // layered on top of the listing-visibility gate below, which is the real
  // authorization boundary.
  const rateCheck = await checkConversationRate({ userId: buyerId, ip });
  if (!rateCheck.ok) {
    throw codedError("RATE_LIMITED", "Too many conversations opened, please slow down");
  }

  // Listing-visibility gate: a new buyer thread may only be started on a
  // listing that is currently publicly contactable — active, not abuse-flagged,
  // and owned by a seller who is not shadow-banned. This mirrors the feed/detail
  // visibility gate so a known listing UUID cannot be used to message the seller
  // of withdrawn, flagged, or shadow-banned inventory (authorization bypass via
  // UUID harvesting). Existing threads stay readable via the inbox
  // (loadParticipantConversation), which is unaffected.
  const [listing] = await db
    .select({ id: listings.id, title: listings.title, sellerId: listings.userId })
    .from(listings)
    .leftJoin(users, eq(listings.userId, users.id))
    .where(
      and(
        eq(listings.id, listingId),
        eq(listings.status, "active"),
        ...publicVisibilityConditions()
      )
    )
    .limit(1);
  if (!listing) throw codedError("NOT_FOUND", "Listing not found");

  const sellerId = listing.sellerId;
  if (!sellerId) throw codedError("INVALID_DATA", "This listing has no owner to message");
  if (sellerId === buyerId) {
    throw codedError("INVALID_DATA", "You cannot message your own listing");
  }

  await db
    .insert(conversations)
    .values({ listingId, buyerId, sellerId })
    .onConflictDoNothing();

  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.listingId, listingId),
        eq(conversations.buyerId, buyerId),
        eq(conversations.sellerId, sellerId)
      )
    )
    .limit(1);

  // Re-opening a thread the buyer had hidden brings it back into their inbox.
  if (conv.buyerDeletedAt) {
    await db
      .update(conversations)
      .set({ buyerDeletedAt: null })
      .where(eq(conversations.id, conv.id));
  }

  const [seller] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, sellerId))
    .limit(1);

  const thumbMap = await getThumbs([listingId]);

  return {
    id: conv.id,
    listing_id: listingId,
    listing_title: listing.title ?? null,
    listing_thumb: thumbMap.get(listingId) ?? null,
    counterparty_id: sellerId,
    counterparty_name: seller?.name ?? "Unknown",
    last_message_text: conv.lastMessageText ?? null,
    last_message_at: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
    unread: conv.buyerUnread ?? 0,
    viewer_role: "buyer",
  };
}

export async function listConversations(
  clerkId: string
): Promise<ConversationSummaryDTO[]> {
  const userId = await getUserId(clerkId);

  const rows = await db
    .select({
      id: conversations.id,
      listingId: conversations.listingId,
      buyerId: conversations.buyerId,
      sellerId: conversations.sellerId,
      lastMessageText: conversations.lastMessageText,
      lastMessageAt: conversations.lastMessageAt,
      buyerUnread: conversations.buyerUnread,
      sellerUnread: conversations.sellerUnread,
      createdAt: conversations.createdAt,
      listingTitle: listings.title,
    })
    .from(conversations)
    .leftJoin(listings, eq(conversations.listingId, listings.id))
    // Per-participant hide: a thread the viewer "deleted" is filtered out for
    // them only, while the counterparty still sees it.
    .where(
      or(
        and(eq(conversations.buyerId, userId), isNull(conversations.buyerDeletedAt)),
        and(eq(conversations.sellerId, userId), isNull(conversations.sellerDeletedAt))
      )
    )
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt));

  if (rows.length === 0) return [];

  const counterpartyIds = Array.from(
    new Set(rows.map((r) => (r.buyerId === userId ? r.sellerId : r.buyerId)))
  );
  const nameRows = counterpartyIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, counterpartyIds))
    : [];
  const nameMap = new Map(nameRows.map((n) => [n.id, n.name]));

  const listingIds = Array.from(new Set(rows.map((r) => r.listingId)));
  const thumbMap = await getThumbs(listingIds);

  return rows.map((r) => {
    const isBuyer = r.buyerId === userId;
    const cpId = isBuyer ? r.sellerId : r.buyerId;
    return {
      id: r.id,
      listing_id: r.listingId,
      listing_title: r.listingTitle ?? null,
      listing_thumb: thumbMap.get(r.listingId) ?? null,
      counterparty_id: cpId,
      counterparty_name: nameMap.get(cpId) ?? "Unknown",
      last_message_text: r.lastMessageText ?? null,
      last_message_at: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
      unread: isBuyer ? r.buyerUnread ?? 0 : r.sellerUnread ?? 0,
      viewer_role: isBuyer ? "buyer" : "seller",
    };
  });
}

export async function getMessages(
  clerkId: string,
  conversationId: string
): Promise<MessageDTO[]> {
  const userId = await getUserId(clerkId);
  await loadParticipantConversation(conversationId, userId);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  // Batch-resolve reply previews (within this conversation) and shared-listing
  // cards so the thread renders quoted replies + listing cards without N+1.
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const replyMap = new Map<string, MessageReplyPreview>();
  if (replyIds.length) {
    const reps = await db
      .select({ id: messages.id, body: messages.body, senderId: messages.senderId })
      .from(messages)
      .where(inArray(messages.id, replyIds));
    for (const r of reps) replyMap.set(r.id, { id: r.id, body: r.body, sender_id: r.senderId });
  }

  const listingIds = [...new Set(rows.map((r) => r.listingRefId).filter((x): x is string => !!x))];
  const listingMap = new Map<string, MessageListingRef>();
  if (listingIds.length) {
    const ls = await db
      .select({ id: listings.id, title: listings.title, price: listings.basePriceCash })
      .from(listings)
      .where(inArray(listings.id, listingIds));
    const thumbs = await getThumbs(listingIds);
    for (const l of ls) {
      listingMap.set(l.id, { id: l.id, title: l.title ?? null, thumb: thumbs.get(l.id) ?? null, price: l.price ?? null });
    }
  }

  return rows.map((m) => {
    const { reactions, my_reactions } = summarizeReactions(m.reactions, userId);
    return {
      id: m.id,
      conversation_id: m.conversationId,
      sender_id: m.senderId,
      body: m.body,
      is_mine: m.senderId === userId,
      created_at: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
      read_at: m.readAt ? m.readAt.toISOString() : null,
      media_url: m.mediaUrl ?? null,
      media_kind: m.mediaKind ?? null,
      reactions,
      my_reactions,
      reply_to: m.replyToId ? replyMap.get(m.replyToId) ?? null : null,
      listing_ref: m.listingRefId ? listingMap.get(m.listingRefId) ?? null : null,
    };
  });
}

export interface SendMessageInput {
  /** Public serving URL of an attachment (image/video/voice). */
  mediaUrl?: string | null;
  /** Attachment kind: "image" | "video" | "audio". Defaults to image when a URL is present. */
  mediaKind?: string | null;
  /** Reply/quote target — must be a message in the same conversation. */
  replyToId?: string | null;
  /** A listing shared as a card inside the chat. */
  listingRefId?: string | null;
}

export async function sendMessage(
  clerkId: string,
  conversationId: string,
  body: string,
  opts: SendMessageInput = {}
): Promise<MessageDTO> {
  const userId = await getUserId(clerkId);
  const conv = await loadParticipantConversation(conversationId, userId);

  const text = body.trim();
  const mediaUrl = opts.mediaUrl ?? null;
  const replyToId = opts.replyToId ?? null;
  const listingRefId = opts.listingRefId ?? null;
  const mediaKind = opts.mediaKind ?? (mediaUrl ? "image" : null);
  // A message must carry something: text, an attachment, or a shared listing.
  if (!text && !mediaUrl && !listingRefId) {
    throw codedError("INVALID_DATA", "Message must contain text, media, or a shared listing");
  }

  // A reply may only quote a message in THIS conversation (no cross-thread leak).
  if (replyToId) {
    const [target] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, replyToId), eq(messages.conversationId, conversationId)))
      .limit(1);
    if (!target) throw codedError("INVALID_DATA", "Reply target not found in this conversation");
  }
  // A shared listing must exist.
  if (listingRefId) {
    const [l] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.id, listingRefId))
      .limit(1);
    if (!l) throw codedError("INVALID_DATA", "Shared listing not found");
  }

  // Anti-spam: cap how fast a single user can fire messages. A block is surfaced
  // as a 429 by the route layer; the attempt is audited inside AbuseService.
  const rate = await checkMessageRate({ userId });
  if (!rate.ok) throw codedError("RATE_LIMITED", "Too many messages, please slow down");

  const isBuyer = conv.buyerId === userId;
  const recipientId = isBuyer ? conv.sellerId : conv.buyerId;

  const [msg] = await db
    .insert(messages)
    .values({ conversationId, senderId: userId, body: text, mediaUrl, mediaKind, replyToId, listingRefId })
    .returning();

  // Promote an attached image to public ACL so the recipient's client can load
  // it from the ACL-gated serve handler (mobile <Image> sends no bearer token).
  // Best-effort: promoteServingUrlToPublic swallows failures and no-ops URLs
  // that aren't our own first-party uploads.
  if (msg.mediaUrl) {
    await assertCallerMayUseUpload(msg.mediaUrl, clerkId);
    await objectStorageService.promoteServingUrlToPublic(msg.mediaUrl, clerkId);
    const wildcard = parseServingWildcard(msg.mediaUrl);
    if (wildcard) await consumeUploadClaim(servingWildcardToObjectPath(wildcard));
  }

  // Inbox preview: the text, else a glyph for the attachment / shared listing.
  const preview =
    text ||
    (mediaKind === "audio"
      ? "🎤 Voice message"
      : mediaKind === "video"
        ? "🎬 Video"
        : mediaUrl
          ? "📷 Photo"
          : listingRefId
            ? "📎 Listing"
            : "📷");
  const now = new Date();
  await db
    .update(conversations)
    .set({
      lastMessageText: preview,
      lastMessageAt: now,
      // A new message un-hides the thread for whoever had deleted it.
      buyerDeletedAt: null,
      sellerDeletedAt: null,
      ...(isBuyer
        ? { sellerUnread: sql`${conversations.sellerUnread} + 1` }
        : { buyerUnread: sql`${conversations.buyerUnread} + 1` }),
    })
    .where(eq(conversations.id, conversationId));

  const [sender] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await createNotification({
    userId: recipientId,
    type: "message",
    title: sender?.name ?? "New message",
    body: preview.length > 80 ? `${preview.slice(0, 79)}…` : preview,
    data: {
      conversation_id: conversationId,
      listing_id: conv.listingId,
      counterparty_name: sender?.name ?? null,
      viewer_role: isBuyer ? "seller" : "buyer",
    },
  });

  // Resolve the reply preview + shared-listing card for the returned message so
  // the sender's client can render them immediately (no thread refetch needed).
  let reply_to: MessageReplyPreview | null = null;
  if (msg.replyToId) {
    const [r] = await db
      .select({ id: messages.id, body: messages.body, senderId: messages.senderId })
      .from(messages)
      .where(eq(messages.id, msg.replyToId))
      .limit(1);
    if (r) reply_to = { id: r.id, body: r.body, sender_id: r.senderId };
  }
  let listing_ref: MessageListingRef | null = null;
  if (msg.listingRefId) {
    const [l] = await db
      .select({ id: listings.id, title: listings.title, price: listings.basePriceCash })
      .from(listings)
      .where(eq(listings.id, msg.listingRefId))
      .limit(1);
    if (l) {
      const thumbs = await getThumbs([l.id]);
      listing_ref = { id: l.id, title: l.title ?? null, thumb: thumbs.get(l.id) ?? null, price: l.price ?? null };
    }
  }

  return {
    id: msg.id,
    conversation_id: conversationId,
    sender_id: userId,
    body: msg.body,
    is_mine: true,
    created_at: msg.createdAt ? msg.createdAt.toISOString() : now.toISOString(),
    read_at: null,
    media_url: msg.mediaUrl ?? null,
    media_kind: msg.mediaKind ?? null,
    reactions: {},
    my_reactions: [],
    reply_to,
    listing_ref,
  };
}

export async function markConversationRead(
  clerkId: string,
  conversationId: string
): Promise<{ read: boolean }> {
  const userId = await getUserId(clerkId);
  const conv = await loadParticipantConversation(conversationId, userId);
  const isBuyer = conv.buyerId === userId;

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        ne(messages.senderId, userId),
        isNull(messages.readAt)
      )
    );

  await db
    .update(conversations)
    .set(isBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 })
    .where(eq(conversations.id, conversationId));

  return { read: true };
}

/**
 * Soft-hide a conversation for the requesting participant only. The thread stays
 * visible for the counterparty, and any future message clears both flags so it
 * reappears for whoever had hidden it (see sendMessage).
 */
export async function deleteConversation(
  clerkId: string,
  conversationId: string
): Promise<{ deleted: boolean }> {
  const userId = await getUserId(clerkId);
  const conv = await loadParticipantConversation(conversationId, userId);
  const isBuyer = conv.buyerId === userId;

  await db
    .update(conversations)
    .set(isBuyer ? { buyerDeletedAt: new Date() } : { sellerDeletedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { deleted: true };
}

/**
 * Toggle the caller's emoji reaction on a message. Reactions live in a jsonb map
 * ({ "<emoji>": [userId, ...] }); a FOR UPDATE row lock serializes concurrent
 * toggles so counts can't be lost. Only allowlisted emojis are accepted and the
 * caller must be a participant of the message's conversation.
 */
export async function reactToMessage(
  clerkId: string,
  conversationId: string,
  messageId: string,
  emoji: string
): Promise<{ reactions: Record<string, number>; my_reactions: string[] }> {
  if (!REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number])) {
    throw codedError("INVALID_DATA", "Unsupported reaction");
  }
  const userId = await getUserId(clerkId);
  await loadParticipantConversation(conversationId, userId);

  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ id: messages.id, reactions: messages.reactions })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
      .for("update")
      .limit(1);
    if (!m) throw codedError("NOT_FOUND", "Message not found");

    const map: Record<string, string[]> = {};
    if (m.reactions && typeof m.reactions === "object" && !Array.isArray(m.reactions)) {
      for (const [e, uids] of Object.entries(m.reactions as Record<string, unknown>)) {
        if (Array.isArray(uids)) {
          map[e] = uids.filter((u): u is string => typeof u === "string");
        }
      }
    }
    const arr = map[emoji] ?? [];
    const idx = arr.indexOf(userId);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(userId);
    if (arr.length) map[emoji] = arr;
    else delete map[emoji];

    await tx.update(messages).set({ reactions: map }).where(eq(messages.id, messageId));
    return summarizeReactions(map, userId);
  });
}
