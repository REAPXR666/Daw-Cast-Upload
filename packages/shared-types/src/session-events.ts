import { z } from "zod";

/**
 * WebSocket signaling protocol between desktop-client and signaling-server.
 *
 * RTP/DTLS/SCTP parameters are mediasoup-native shapes. They're passed through
 * this layer as opaque JSON (z.record/unknown) rather than re-typed here, so
 * shared-types doesn't take a hard dependency on the mediasoup package —
 * callers on both ends cast to the concrete mediasoup-client / mediasoup
 * server types they already have in scope.
 */

export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const MediaKindSchema = z.enum(["audio", "video"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** What an audio/video producer actually is — lets consumers route it correctly (e.g. mic audio plays through a chosen output device, screen audio doesn't need a device picker). */
export const MediaTagSchema = z.enum(["screen", "system-audio", "mic"]);
export type MediaTag = z.infer<typeof MediaTagSchema>;

export const TransportDirectionSchema = z.enum(["send", "recv"]);
export type TransportDirection = z.infer<typeof TransportDirectionSchema>;

export const PermissionsSchema = z.object({
  mouse: z.boolean(),
  keyboard: z.boolean(),
  fileTransfer: z.boolean(),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

export const MouseButtonSchema = z.enum(["left", "right", "middle"]);
export type MouseButton = z.infer<typeof MouseButtonSchema>;

/**
 * Semantic input intents sent by a joiner — never raw OS events. The server
 * is the sole authority on whether a sender currently holds the matching
 * permission (see Permissions above) and silently drops anything from an
 * ungranted user before it's ever relayed to the host; only the host process
 * ever calls the native SendInput addon. x/y are normalized [0,1] against the
 * shared screen's resolution, not device pixels.
 */
export const InputIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mouseMove"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("mouseButton"), button: MouseButtonSchema, down: z.boolean() }),
  z.object({ kind: z.literal("mouseScroll"), deltaX: z.number(), deltaY: z.number() }),
  // `code` is a standard DOM UI Events code value (e.g. "KeyA", "ShiftLeft",
  // "Enter") captured on the joiner's side — platform-neutral. Only the host,
  // which owns the native SendInput addon, maps it to a Windows VK code.
  z.object({ kind: z.literal("keyEvent"), code: z.string(), down: z.boolean() }),
  z.object({ kind: z.literal("typeText"), text: z.string().max(500) }),
]);
export type InputIntent = z.infer<typeof InputIntentSchema>;

/** Extensions the file-transfer pipeline accepts — samples/audio only, checked both client- and server-side. */
export const ALLOWED_FILE_EXTENSIONS = ["wav", "mp3", "aiff", "aif", "flac", "ogg"] as const;
export const MAX_FILE_TRANSFER_BYTES = 200 * 1024 * 1024; // 200MB

export const FileMetaSchema = z.object({
  filename: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_TRANSFER_BYTES),
  mimeType: z.string().max(127),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

// ---------- Client -> Server ----------

export const ClientToServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host:createSession") }),

  z.object({
    type: z.literal("join:requestByCode"),
    inviteCode: z.string().length(6),
  }),

  z.object({
    type: z.literal("join:respond"),
    requestId: z.string().uuid(),
    approve: z.boolean(),
  }),

  z.object({
    type: z.literal("transport:create"),
    direction: TransportDirectionSchema,
  }),

  z.object({
    type: z.literal("transport:connect"),
    transportId: z.string(),
    dtlsParameters: z.record(z.unknown()),
  }),

  z.object({
    type: z.literal("transport:produce"),
    transportId: z.string(),
    kind: MediaKindSchema,
    rtpParameters: z.record(z.unknown()),
    appData: z.record(z.unknown()).optional(),
  }),

  z.object({
    type: z.literal("transport:consume"),
    producerId: z.string(),
  }),

  z.object({
    type: z.literal("rtp:setCapabilities"),
    rtpCapabilities: z.record(z.unknown()),
  }),

  z.object({
    type: z.literal("consumer:resume"),
    consumerId: z.string(),
  }),

  z.object({
    type: z.literal("chat:message"),
    body: z.string().min(1).max(2000),
  }),

  z.object({
    type: z.literal("session:leave"),
  }),

  // Host-only — enforced server-side against the session's hostUserId.
  z.object({
    type: z.literal("permission:set"),
    targetUserId: z.string().uuid(),
    permissions: PermissionsSchema,
  }),

  // Dropped server-side (never relayed) unless the sender currently holds
  // the matching granted permission for this session.
  z.object({
    type: z.literal("input:send"),
    intent: InputIntentSchema,
  }),

  // Rejected server-side unless the sender holds fileTransfer permission,
  // the extension is allow-listed, and size is within the cap.
  z.object({
    type: z.literal("data:produce"),
    transportId: z.string(),
    sctpStreamParameters: z.record(z.unknown()),
    label: z.string(),
    protocol: z.string(),
    fileMeta: FileMetaSchema,
  }),

  z.object({
    type: z.literal("data:consume"),
    dataProducerId: z.string(),
  }),

  // Host-only. Transient — the removed user can rejoin the same or future sessions.
  z.object({
    type: z.literal("participant:kick"),
    targetUserId: z.string().uuid(),
  }),

  // Host-only. Persistent — creates a Ban row; the target can never join any
  // session hosted by this host again (enforced in join:requestByCode).
  z.object({
    type: z.literal("participant:ban"),
    targetUserId: z.string().uuid(),
  }),

  // Admin/master_admin-only (re-checked server-side against the connection's
  // JWT role, never trusted from the client). Joins the session as an
  // invisible, consume-only observer: not added to the participant list, no
  // join broadcast fires, and the server structurally refuses to let this
  // connection ever produce media (see SessionManager.produce).
  z.object({
    type: z.literal("admin:monitorSession"),
    inviteCode: z.string().length(6),
  }),
]);
export type ClientToServerEvent = z.infer<typeof ClientToServerEventSchema>;

// ---------- Server -> Client ----------

export const ServerToClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session:created"),
    sessionId: z.string().uuid(),
    inviteCode: z.string().length(6),
    rtpCapabilities: z.record(z.unknown()),
  }),

  z.object({
    type: z.literal("join:incomingRequest"),
    requestId: z.string().uuid(),
    fromUser: PublicUserSchema,
  }),

  z.object({
    type: z.literal("join:approved"),
    sessionId: z.string().uuid(),
    rtpCapabilities: z.record(z.unknown()),
    existingProducers: z.array(
      z.object({
        producerId: z.string(),
        kind: MediaKindSchema,
        ownerUserId: z.string().uuid(),
        mediaTag: MediaTagSchema,
      }),
    ),
    // The host + any other already-connected participants — without this the
    // joiner's own participant list only ever shows people who join *after*
    // them, never who was already there (including the host).
    existingParticipants: z.array(PublicUserSchema),
  }),

  z.object({
    type: z.literal("join:denied"),
    reason: z.string(),
  }),

  z.object({
    type: z.literal("participant:joined"),
    user: PublicUserSchema,
  }),

  z.object({
    type: z.literal("participant:left"),
    userId: z.string().uuid(),
  }),

  z.object({
    type: z.literal("transport:created"),
    transportId: z.string(),
    iceParameters: z.record(z.unknown()),
    iceCandidates: z.array(z.record(z.unknown())),
    dtlsParameters: z.record(z.unknown()),
    sctpParameters: z.record(z.unknown()).optional(),
  }),

  z.object({
    type: z.literal("transport:produced"),
    producerId: z.string(),
  }),

  z.object({
    type: z.literal("producer:new"),
    producerId: z.string(),
    kind: MediaKindSchema,
    ownerUserId: z.string().uuid(),
    mediaTag: MediaTagSchema,
  }),

  z.object({
    type: z.literal("consumer:created"),
    id: z.string(),
    producerId: z.string(),
    kind: MediaKindSchema,
    rtpParameters: z.record(z.unknown()),
  }),

  z.object({
    type: z.literal("chat:message"),
    from: PublicUserSchema,
    body: z.string(),
    sentAt: z.string().datetime(),
  }),

  z.object({
    type: z.literal("session:closed"),
    reason: z.string(),
  }),

  z.object({
    type: z.literal("ack"),
  }),

  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),

  // Broadcast to the whole session so every client's UI reflects current grants.
  z.object({
    type: z.literal("permission:updated"),
    userId: z.string().uuid(),
    permissions: PermissionsSchema,
  }),

  // Pushed only to the host — the relay of an already-permission-checked intent.
  z.object({
    type: z.literal("input:receive"),
    fromUserId: z.string().uuid(),
    intent: InputIntentSchema,
  }),

  z.object({
    type: z.literal("data:produced"),
    dataProducerId: z.string(),
  }),

  z.object({
    type: z.literal("data:consumerCreated"),
    id: z.string(),
    dataProducerId: z.string(),
    sctpStreamParameters: z.record(z.unknown()),
    label: z.string(),
    protocol: z.string(),
  }),

  // Pushed only to the host when a permitted joiner starts sending a file.
  z.object({
    type: z.literal("dataProducer:new"),
    dataProducerId: z.string(),
    fromUserId: z.string().uuid(),
    fileMeta: FileMetaSchema,
  }),

  // Pushed only to the removed user — kick and ban both use this, distinguished by `permanent`.
  z.object({
    type: z.literal("removedFromSession"),
    reason: z.string(),
    permanent: z.boolean(),
  }),

  z.object({
    type: z.literal("admin:monitorJoined"),
    sessionId: z.string().uuid(),
    rtpCapabilities: z.record(z.unknown()),
    existingProducers: z.array(
      z.object({
        producerId: z.string(),
        kind: MediaKindSchema,
        ownerUserId: z.string().uuid(),
        mediaTag: MediaTagSchema,
      }),
    ),
  }),
]);
export type ServerToClientEvent = z.infer<typeof ServerToClientEventSchema>;

/**
 * Every client->server send is wrapped with a client-generated correlation id
 * so RPC-style calls (transport:create, transport:connect, transport:produce,
 * transport:consume, consumer:resume — anything mediasoup-client awaits a
 * promise on) can be matched to their server response. Fire-and-forget-looking
 * calls (chat:message, session:leave) still get a response — a simple "ack" —
 * for a uniform client-side request/response helper.
 *
 * Server-initiated messages that aren't a response to a specific client call
 * (join:incomingRequest to the host, participant:joined/left, producer:new,
 * session:closed) arrive as "push" envelopes with no correlation id.
 */
export const ClientMessageSchema = z.object({
  id: z.string().uuid(),
  event: ClientToServerEventSchema,
});
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Plain union (not discriminatedUnion): two branches share kind: "response",
// which only differ on the nested `ok` literal — discriminatedUnion requires
// unique top-level discriminant values, so a plain union is used instead.
export const ServerMessageSchema = z.union([
  z.object({
    kind: z.literal("response"),
    id: z.string().uuid(),
    ok: z.literal(true),
    event: ServerToClientEventSchema,
  }),
  z.object({
    kind: z.literal("response"),
    id: z.string().uuid(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    kind: z.literal("push"),
    event: ServerToClientEventSchema,
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
