import { randomUUID } from "node:crypto";
import type { types as MediasoupTypes } from "mediasoup";
import { prisma } from "@daw-cast/db";
import {
  ALLOWED_FILE_EXTENSIONS,
  SESSION_CAPACITY,
  type FileMeta,
  type InputIntent,
  type MediaTag,
  type Permissions,
} from "@daw-cast/shared-types";
import { createRouter } from "../mediasoup/worker-pool.js";
import { webRtcTransportOptions } from "../mediasoup/config.js";
import { mintInviteCode, resolveInviteCode, releaseInviteCode } from "./invite-codes.js";
import { AppError } from "./errors.js";
import { TypedEmitter } from "./event-bus.js";
import type {
  SessionState,
  ParticipantState,
  PendingJoinRequest,
  ProducerRef,
  SessionManagerEvents,
} from "./types.js";
import { NO_PERMISSIONS } from "./types.js";
import { env } from "../env.js";

function mediaTagOf(producer: MediasoupTypes.Producer): MediaTag {
  const tag = (producer.appData as Record<string, unknown> | undefined)?.mediaTag;
  return tag === "screen" || tag === "system-audio" || tag === "mic" ? tag : "mic";
}

export class SessionManager extends TypedEmitter<SessionManagerEvents> {
  private sessions = new Map<string, SessionState>();
  private userIdToSessionId = new Map<string, string>();
  private pendingJoinRequests = new Map<string, PendingJoinRequest>();

  private getSessionForUser(userId: string): SessionState {
    const sessionId = this.userIdToSessionId.get(userId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) throw new AppError("not_in_session", "You are not currently in a session");
    return session;
  }

  private getParticipant(session: SessionState, userId: string): ParticipantState {
    const participant = session.participants.get(userId);
    if (!participant) throw new AppError("not_a_participant", "You are not a participant in this session");
    return participant;
  }

  /** Like getParticipant, but also matches an invisible monitor connection — used by the generic transport/consume flow, which monitors use identically to participants. */
  private getParticipantOrMonitor(session: SessionState, userId: string): ParticipantState {
    const found = session.participants.get(userId) ?? session.monitors.get(userId);
    if (!found) throw new AppError("not_a_participant", "You are not a participant in this session");
    return found;
  }

  private existingProducerRefs(session: SessionState, excludingUserId?: string): ProducerRef[] {
    const refs: ProducerRef[] = [];
    for (const participant of session.participants.values()) {
      if (participant.userId === excludingUserId) continue;
      for (const producer of participant.producers.values()) {
        refs.push({
          producerId: producer.id,
          kind: producer.kind as "audio" | "video",
          ownerUserId: participant.userId,
          mediaTag: mediaTagOf(producer),
        });
      }
    }
    return refs;
  }

  private otherParticipantIds(session: SessionState, excludingUserId: string): string[] {
    return [...session.participants.keys()].filter((id) => id !== excludingUserId);
  }

  /** Participants plus any invisible monitors — used for media/chat fan-out so admins watching a session actually receive it, without ever appearing in the participant-facing lists above. */
  private viewerIds(session: SessionState, excludingUserId?: string): string[] {
    return [...session.participants.keys(), ...session.monitors.keys()].filter(
      (id) => id !== excludingUserId,
    );
  }

  async createSession(hostUserId: string, hostUsername: string) {
    const router = await createRouter();
    const sessionId = randomUUID();
    const inviteCode = await mintInviteCode(sessionId);

    const subscription = await prisma.subscription.findUnique({ where: { userId: hostUserId } });
    const entitled = subscription?.status === "active" || subscription?.status === "trialing";
    const tier = entitled ? subscription!.tier : "free";
    const maxParticipants = SESSION_CAPACITY[tier as keyof typeof SESSION_CAPACITY] ?? env.FREE_TIER_MAX_PARTICIPANTS;

    const session: SessionState = {
      id: sessionId,
      hostUserId,
      inviteCode,
      router,
      participants: new Map(),
      monitors: new Map(),
      maxParticipants,
      createdAt: new Date(),
    };
    session.participants.set(hostUserId, {
      userId: hostUserId,
      username: hostUsername,
      permissions: { mouse: true, keyboard: true, fileTransfer: true },
      producers: new Map(),
      consumers: new Map(),
      dataProducers: new Map(),
      dataConsumers: new Map(),
    });

    this.sessions.set(sessionId, session);
    this.userIdToSessionId.set(hostUserId, sessionId);

    return {
      sessionId,
      inviteCode,
      rtpCapabilities: router.rtpCapabilities,
    };
  }

  async requestJoinByCode(userId: string, username: string, inviteCode: string): Promise<void> {
    const sessionId = await resolveInviteCode(inviteCode);
    if (!sessionId) throw new AppError("invalid_code", "Invite code not found or expired");

    const session = this.sessions.get(sessionId);
    if (!session) throw new AppError("invalid_code", "That session no longer exists");

    if (session.hostUserId === userId) {
      throw new AppError("invalid_request", "You cannot join your own session");
    }
    if (session.participants.has(userId)) {
      throw new AppError("already_joined", "You are already in this session");
    }
    if (session.participants.size >= session.maxParticipants) {
      throw new AppError("session_full", "This session is full");
    }

    const ban = await prisma.ban.findUnique({
      where: { bannedUserId_hostUserId: { bannedUserId: userId, hostUserId: session.hostUserId } },
    });
    if (ban) throw new AppError("banned", "You have been banned from this host's sessions");

    const requestId = randomUUID();
    this.pendingJoinRequests.set(requestId, { requestId, sessionId, userId, username });

    this.emit("incomingJoinRequest", {
      hostUserId: session.hostUserId,
      requestId,
      fromUser: { id: userId, username },
    });
  }

  respondJoin(hostUserId: string, requestId: string, approve: boolean): void {
    const pending = this.pendingJoinRequests.get(requestId);
    if (!pending) throw new AppError("unknown_request", "That join request no longer exists");

    const session = this.sessions.get(pending.sessionId);
    if (!session || session.hostUserId !== hostUserId) {
      throw new AppError("forbidden", "You are not the host of that session");
    }

    this.pendingJoinRequests.delete(requestId);

    if (!approve) {
      this.emit("joinResolved", { userId: pending.userId, approved: false, reason: "Host denied your request" });
      return;
    }

    if (session.participants.size >= session.maxParticipants) {
      this.emit("joinResolved", { userId: pending.userId, approved: false, reason: "Session filled up before you were approved" });
      return;
    }

    session.participants.set(pending.userId, {
      userId: pending.userId,
      username: pending.username,
      permissions: { ...NO_PERMISSIONS },
      producers: new Map(),
      consumers: new Map(),
      dataProducers: new Map(),
      dataConsumers: new Map(),
    });
    this.userIdToSessionId.set(pending.userId, session.id);

    const existingParticipants = [...session.participants.values()]
      .filter((p) => p.userId !== pending.userId)
      .map((p) => ({ id: p.userId, username: p.username }));

    this.emit("joinResolved", {
      userId: pending.userId,
      approved: true,
      sessionId: session.id,
      rtpCapabilities: session.router.rtpCapabilities,
      existingProducers: this.existingProducerRefs(session, pending.userId),
      existingParticipants,
    });

    this.emit("participantJoined", {
      toUserIds: this.otherParticipantIds(session, pending.userId),
      user: { id: pending.userId, username: pending.username },
    });
  }

  /**
   * Admin-only invisible observation. Never touches session.participants, so
   * no participantJoined event fires and the admin never shows up in anyone's
   * participant list — the server-side role check here is the real gate
   * (dispatch's connection role is only ever a hint, this is the enforcement).
   */
  async monitorSession(
    adminUserId: string,
    adminUsername: string,
    adminRole: string,
    inviteCode: string,
  ) {
    if (adminRole !== "admin" && adminRole !== "master_admin") {
      throw new AppError("forbidden", "Only administrators can monitor a session");
    }

    const sessionId = await resolveInviteCode(inviteCode);
    if (!sessionId) throw new AppError("invalid_code", "Invite code not found or expired");

    const session = this.sessions.get(sessionId);
    if (!session) throw new AppError("invalid_code", "That session no longer exists");

    if (session.participants.has(adminUserId) || session.monitors.has(adminUserId)) {
      throw new AppError("already_joined", "You are already connected to this session");
    }

    session.monitors.set(adminUserId, {
      userId: adminUserId,
      username: adminUsername,
      permissions: { ...NO_PERMISSIONS },
      producers: new Map(),
      consumers: new Map(),
      dataProducers: new Map(),
      dataConsumers: new Map(),
    });
    this.userIdToSessionId.set(adminUserId, sessionId);

    return {
      sessionId: session.id,
      rtpCapabilities: session.router.rtpCapabilities,
      existingProducers: this.existingProducerRefs(session),
    };
  }

  async createTransport(userId: string, direction: "send" | "recv") {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipantOrMonitor(session, userId);

    const transport = await session.router.createWebRtcTransport(webRtcTransportOptions);
    if (direction === "send") participant.sendTransport = transport;
    else participant.recvTransport = transport;

    return {
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  private findTransport(participant: ParticipantState, transportId: string): MediasoupTypes.WebRtcTransport {
    if (participant.sendTransport?.id === transportId) return participant.sendTransport;
    if (participant.recvTransport?.id === transportId) return participant.recvTransport;
    throw new AppError("unknown_transport", "No such transport");
  }

  async connectTransport(
    userId: string,
    transportId: string,
    dtlsParameters: MediasoupTypes.DtlsParameters,
  ): Promise<void> {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipantOrMonitor(session, userId);
    const transport = this.findTransport(participant, transportId);
    await transport.connect({ dtlsParameters });
  }

  setRtpCapabilities(userId: string, rtpCapabilities: MediasoupTypes.RtpCapabilities): void {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipantOrMonitor(session, userId);
    participant.rtpCapabilities = rtpCapabilities;
  }

  async produce(
    userId: string,
    transportId: string,
    kind: "audio" | "video",
    rtpParameters: MediasoupTypes.RtpParameters,
    appData?: Record<string, unknown>,
  ): Promise<{ producerId: string }> {
    const session = this.getSessionForUser(userId);
    // Structural enforcement, not just a hidden client: an invisible monitor
    // connection can never produce media, even if a modified client tried.
    if (session.monitors.has(userId)) {
      throw new AppError("forbidden", "Monitors cannot produce media");
    }
    const participant = this.getParticipant(session, userId);
    const transport = this.findTransport(participant, transportId);
    if (transport !== participant.sendTransport) {
      throw new AppError("invalid_transport_direction", "Cannot produce on a recv transport");
    }

    const producer = await transport.produce({ kind, rtpParameters, appData });
    participant.producers.set(producer.id, producer);

    this.emit("producerNew", {
      toUserIds: this.viewerIds(session, userId),
      producerId: producer.id,
      kind: producer.kind as "audio" | "video",
      ownerUserId: userId,
      mediaTag: mediaTagOf(producer),
    });

    return { producerId: producer.id };
  }

  async consume(userId: string, producerId: string) {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipantOrMonitor(session, userId);
    if (!participant.rtpCapabilities) {
      throw new AppError("not_ready", "Call rtp:setCapabilities before consuming");
    }
    if (!participant.recvTransport) {
      throw new AppError("no_recv_transport", "No recv transport has been created yet");
    }
    if (!session.router.canConsume({ producerId, rtpCapabilities: participant.rtpCapabilities })) {
      throw new AppError("cannot_consume", "This client cannot consume that producer");
    }

    const consumer = await participant.recvTransport.consume({
      producerId,
      rtpCapabilities: participant.rtpCapabilities,
      paused: false,
    });
    participant.consumers.set(consumer.id, consumer);

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind as "audio" | "video",
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(userId: string, consumerId: string): Promise<void> {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipantOrMonitor(session, userId);
    const consumer = participant.consumers.get(consumerId);
    if (!consumer) throw new AppError("unknown_consumer", "No such consumer");
    await consumer.resume();
  }

  /**
   * Creates a DataProducer for an incoming file transfer. Gated on the
   * sender's fileTransfer permission and an extension allow-list — both
   * re-checked here rather than trusted from the client, since the client
   * already validated the same things purely for UX (fast feedback), not
   * as the security boundary.
   */
  async produceData(
    userId: string,
    transportId: string,
    sctpStreamParameters: MediasoupTypes.SctpStreamParameters,
    label: string,
    protocol: string,
    fileMeta: FileMeta,
  ): Promise<{ dataProducerId: string }> {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipant(session, userId);
    if (!participant.permissions.fileTransfer) {
      throw new AppError("forbidden", "You do not have file transfer permission in this session");
    }

    const extension = fileMeta.filename.split(".").pop()?.toLowerCase();
    if (!extension || !(ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new AppError("invalid_file_type", `.${extension ?? "?"} files are not allowed`);
    }

    const transport = this.findTransport(participant, transportId);
    if (transport !== participant.sendTransport) {
      throw new AppError("invalid_transport_direction", "Cannot produce data on a recv transport");
    }

    const dataProducer = await transport.produceData({
      sctpStreamParameters,
      label,
      protocol,
      appData: { ...fileMeta },
    });
    participant.dataProducers.set(dataProducer.id, dataProducer);

    this.emit("dataProducerNew", {
      hostUserId: session.hostUserId,
      dataProducerId: dataProducer.id,
      fromUserId: userId,
      fileMeta,
    });

    return { dataProducerId: dataProducer.id };
  }

  async consumeData(userId: string, dataProducerId: string) {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipant(session, userId);
    if (!participant.recvTransport) {
      throw new AppError("no_recv_transport", "No recv transport has been created yet");
    }

    const dataConsumer = await participant.recvTransport.consumeData({ dataProducerId });
    participant.dataConsumers.set(dataConsumer.id, dataConsumer);
    if (!dataConsumer.sctpStreamParameters) {
      throw new AppError("internal_error", "Data consumer was created without SCTP parameters");
    }

    return {
      id: dataConsumer.id,
      dataProducerId,
      sctpStreamParameters: dataConsumer.sctpStreamParameters,
      label: dataConsumer.label,
      protocol: dataConsumer.protocol,
    };
  }

  setPermissions(hostUserId: string, targetUserId: string, permissions: Permissions): void {
    const session = this.getSessionForUser(hostUserId);
    if (session.hostUserId !== hostUserId) {
      throw new AppError("forbidden", "Only the host can change permissions");
    }
    const target = session.participants.get(targetUserId);
    if (!target) throw new AppError("not_a_participant", "That user is not in this session");

    target.permissions = permissions;

    this.emit("permissionUpdated", {
      toUserIds: [...session.participants.keys()],
      userId: targetUserId,
      permissions,
    });
  }

  /**
   * Server-authoritative input gating: an intent is relayed to the host only
   * if the sender currently holds the matching granted permission. Anything
   * else is silently dropped here — the host is never even told about it, so
   * a compromised joiner client gains nothing by sending intents anyway.
   */
  sendInput(userId: string, intent: InputIntent): void {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipant(session, userId);

    const requiresKeyboard = intent.kind === "keyEvent" || intent.kind === "typeText";
    const granted = requiresKeyboard ? participant.permissions.keyboard : participant.permissions.mouse;
    if (!granted) return;

    this.emit("inputReceived", { hostUserId: session.hostUserId, fromUserId: userId, intent });
  }

  sendChatMessage(userId: string, body: string): void {
    const session = this.getSessionForUser(userId);
    const participant = this.getParticipant(session, userId);

    this.emit("chatMessage", {
      toUserIds: this.viewerIds(session),
      from: { id: userId, username: participant.username },
      body,
      sentAt: new Date().toISOString(),
    });
  }

  /** Called on explicit session:leave and on socket disconnect alike. */
  leave(userId: string): void {
    const sessionId = this.userIdToSessionId.get(userId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    this.userIdToSessionId.delete(userId);

    // Clean up any join request this user had in flight.
    for (const [requestId, pending] of this.pendingJoinRequests) {
      if (pending.userId === userId) this.pendingJoinRequests.delete(requestId);
    }

    if (!session) return;

    // A monitor leaving is invisible on the way out too — no broadcast, just cleanup.
    const monitor = session.monitors.get(userId);
    if (monitor) {
      this.closeParticipantMedia(monitor);
      session.monitors.delete(userId);
      return;
    }

    const participant = session.participants.get(userId);
    if (participant) {
      this.closeParticipantMedia(participant);
      session.participants.delete(userId);
    }

    if (userId === session.hostUserId) {
      // Host leaving ends the session — they're the sole media source in Phase 1.
      const remaining = [...session.participants.keys()];
      for (const remainingUserId of remaining) {
        this.userIdToSessionId.delete(remainingUserId);
      }
      for (const monitorUserId of session.monitors.keys()) {
        this.userIdToSessionId.delete(monitorUserId);
      }
      this.closeSession(session, "Host ended the session");
      this.emit("sessionClosed", { toUserIds: remaining, reason: "Host ended the session" });
    } else {
      this.emit("participantLeft", { toUserIds: this.otherParticipantIds(session, userId), userId });
    }
  }

  /** Transient — the target can rejoin the same or any future session immediately. */
  kick(hostUserId: string, targetUserId: string): void {
    this.removeByHost(hostUserId, targetUserId, "You were kicked by the host", false);
  }

  /** Persistent — records a Ban row so the target can never join a session hosted by this host again. */
  async ban(hostUserId: string, targetUserId: string): Promise<void> {
    const session = this.getSessionForUser(hostUserId);
    if (session.hostUserId !== hostUserId) {
      throw new AppError("forbidden", "Only the host can ban participants");
    }

    await prisma.ban.upsert({
      where: { bannedUserId_hostUserId: { bannedUserId: targetUserId, hostUserId } },
      create: { bannedUserId: targetUserId, hostUserId },
      update: {},
    });

    this.removeByHost(hostUserId, targetUserId, "You were banned by the host", true);
  }

  private removeByHost(hostUserId: string, targetUserId: string, reason: string, permanent: boolean): void {
    const session = this.getSessionForUser(hostUserId);
    if (session.hostUserId !== hostUserId) {
      throw new AppError("forbidden", "Only the host can remove participants");
    }
    if (targetUserId === hostUserId) {
      throw new AppError("invalid_request", "The host cannot remove themselves");
    }
    const participant = session.participants.get(targetUserId);
    if (!participant) throw new AppError("not_a_participant", "That user is not in this session");

    this.closeParticipantMedia(participant);
    session.participants.delete(targetUserId);
    this.userIdToSessionId.delete(targetUserId);

    this.emit("removedFromSession", {
      targetUserId,
      toOthers: this.otherParticipantIds(session, targetUserId),
      reason,
      permanent,
    });
  }

  private closeParticipantMedia(participant: ParticipantState): void {
    for (const producer of participant.producers.values()) producer.close();
    for (const consumer of participant.consumers.values()) consumer.close();
    for (const dataProducer of participant.dataProducers.values()) dataProducer.close();
    for (const dataConsumer of participant.dataConsumers.values()) dataConsumer.close();
    participant.sendTransport?.close();
    participant.recvTransport?.close();
  }

  private closeSession(session: SessionState, _reason: string): void {
    for (const participant of session.participants.values()) this.closeParticipantMedia(participant);
    for (const monitor of session.monitors.values()) this.closeParticipantMedia(monitor);
    session.router.close();
    this.sessions.delete(session.id);
    void releaseInviteCode(session.inviteCode);
  }
}

export const sessionManager = new SessionManager();
