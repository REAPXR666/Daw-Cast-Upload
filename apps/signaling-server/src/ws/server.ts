import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AccessTokenClaims } from "@daw-cast/shared-types";
import {
  ClientMessageSchema,
  type ServerMessage,
  type ServerToClientEvent,
} from "@daw-cast/shared-types";
import { verifyAccessToken } from "../auth.js";
import { sessionManager } from "../session/manager.js";
import { AppError } from "../session/errors.js";
import {
  registerConnection,
  unregisterConnection,
  getConnection,
  type ConnectionContext,
} from "./connection-registry.js";
import { dispatchClientEvent } from "./dispatch.js";

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendPush(userId: string, event: ServerToClientEvent): void {
  const ctx = getConnection(userId);
  if (ctx) send(ctx.ws, { kind: "push", event });
}

function wireSessionManagerEvents(): void {
  sessionManager.on("incomingJoinRequest", ({ hostUserId, requestId, fromUser }) => {
    sendPush(hostUserId, { type: "join:incomingRequest", requestId, fromUser });
  });

  sessionManager.on("joinResolved", (payload) => {
    const ctx = getConnection(payload.userId);
    if (!ctx || !ctx.pendingJoinRpcId) return;

    const event: ServerToClientEvent = payload.approved
      ? {
          type: "join:approved",
          sessionId: payload.sessionId,
          rtpCapabilities: payload.rtpCapabilities,
          existingProducers: payload.existingProducers,
          existingParticipants: payload.existingParticipants,
        }
      : { type: "join:denied", reason: payload.reason };

    send(ctx.ws, { kind: "response", id: ctx.pendingJoinRpcId, ok: true, event });
    ctx.pendingJoinRpcId = null;
  });

  sessionManager.on("participantJoined", ({ toUserIds, user }) => {
    for (const userId of toUserIds) sendPush(userId, { type: "participant:joined", user });
  });

  sessionManager.on("participantLeft", ({ toUserIds, userId }) => {
    for (const id of toUserIds) sendPush(id, { type: "participant:left", userId });
  });

  sessionManager.on("producerNew", ({ toUserIds, producerId, kind, ownerUserId, mediaTag }) => {
    for (const userId of toUserIds) {
      sendPush(userId, { type: "producer:new", producerId, kind, ownerUserId, mediaTag });
    }
  });

  sessionManager.on("chatMessage", ({ toUserIds, from, body, sentAt }) => {
    for (const userId of toUserIds) sendPush(userId, { type: "chat:message", from, body, sentAt });
  });

  sessionManager.on("sessionClosed", ({ toUserIds, reason }) => {
    for (const userId of toUserIds) sendPush(userId, { type: "session:closed", reason });
  });

  sessionManager.on("permissionUpdated", ({ toUserIds, userId, permissions }) => {
    for (const id of toUserIds) sendPush(id, { type: "permission:updated", userId, permissions });
  });

  sessionManager.on("inputReceived", ({ hostUserId, fromUserId, intent }) => {
    sendPush(hostUserId, { type: "input:receive", fromUserId, intent });
  });

  sessionManager.on("dataProducerNew", ({ hostUserId, dataProducerId, fromUserId, fileMeta }) => {
    sendPush(hostUserId, { type: "dataProducer:new", dataProducerId, fromUserId, fileMeta });
  });

  sessionManager.on("removedFromSession", ({ targetUserId, toOthers, reason, permanent }) => {
    sendPush(targetUserId, { type: "removedFromSession", reason, permanent });
    for (const userId of toOthers) sendPush(userId, { type: "participant:left", userId: targetUserId });
  });
}

wireSessionManagerEvents();

interface AuthenticatedRequest extends IncomingMessage {
  authClaims?: AccessTokenClaims;
}

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: AuthenticatedRequest, socket, head) => {
    const url = new URL(req.url ?? "", "http://internal");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      req.authClaims = verifyAccessToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: AuthenticatedRequest) => {
    const claims = req.authClaims;
    if (!claims) {
      ws.close(1008, "unauthorized");
      return;
    }

    const ctx: ConnectionContext = {
      userId: claims.sub,
      username: claims.username,
      role: claims.role,
      ws,
      pendingJoinRpcId: null,
    };
    registerConnection(ctx);

    ws.on("message", (raw) => {
      void handleMessage(ctx, raw.toString());
    });

    ws.on("close", () => {
      sessionManager.leave(ctx.userId);
      unregisterConnection(ctx.userId);
    });
  });
}

async function handleMessage(ctx: ConnectionContext, raw: string): Promise<void> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return; // silently drop malformed frames
  }

  const parsed = ClientMessageSchema.safeParse(parsedJson);
  if (!parsed.success) return;

  const { id, event } = parsed.data;

  // Track this as the RPC to resolve later once the host approves/denies.
  if (event.type === "join:requestByCode") {
    ctx.pendingJoinRpcId = id;
  }

  try {
    const responseEvent = await dispatchClientEvent(ctx, event);
    if (responseEvent !== null) {
      send(ctx.ws, { kind: "response", id, ok: true, event: responseEvent });
    }
  } catch (err) {
    if (event.type === "join:requestByCode") ctx.pendingJoinRpcId = null;
    const code = err instanceof AppError ? err.code : "internal_error";
    const message = err instanceof Error ? err.message : "Unexpected error";
    send(ctx.ws, { kind: "response", id, ok: false, error: { code, message } });
  }
}
