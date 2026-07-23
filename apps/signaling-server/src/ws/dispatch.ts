import type { types as MediasoupTypes } from "mediasoup";
import type { ClientToServerEvent, ServerToClientEvent } from "@daw-cast/shared-types";
import { sessionManager } from "../session/manager.js";
import type { ConnectionContext } from "./connection-registry.js";

/**
 * Handles one already-validated client event and returns the ServerToClientEvent
 * to embed in the RPC response — or `null` if no response should be sent yet
 * (currently only join:requestByCode, which resolves later via the
 * `joinResolved` domain event once the host approves/denies).
 */
export async function dispatchClientEvent(
  ctx: ConnectionContext,
  event: ClientToServerEvent,
): Promise<ServerToClientEvent | null> {
  switch (event.type) {
    case "host:createSession": {
      const result = await sessionManager.createSession(ctx.userId, ctx.username);
      return { type: "session:created", ...result };
    }

    case "join:requestByCode": {
      await sessionManager.requestJoinByCode(ctx.userId, ctx.username, event.inviteCode);
      return null; // resolved later by the `joinResolved` event once the host responds
    }

    case "join:respond": {
      sessionManager.respondJoin(ctx.userId, event.requestId, event.approve);
      return { type: "ack" };
    }

    case "transport:create": {
      const result = await sessionManager.createTransport(ctx.userId, event.direction);
      return { type: "transport:created", ...result };
    }

    case "transport:connect": {
      await sessionManager.connectTransport(
        ctx.userId,
        event.transportId,
        event.dtlsParameters as MediasoupTypes.DtlsParameters,
      );
      return { type: "ack" };
    }

    case "transport:produce": {
      const result = await sessionManager.produce(
        ctx.userId,
        event.transportId,
        event.kind,
        event.rtpParameters as MediasoupTypes.RtpParameters,
        event.appData,
      );
      return { type: "transport:produced", ...result };
    }

    case "transport:consume": {
      const result = await sessionManager.consume(ctx.userId, event.producerId);
      return { type: "consumer:created", ...result };
    }

    case "rtp:setCapabilities": {
      sessionManager.setRtpCapabilities(
        ctx.userId,
        event.rtpCapabilities as MediasoupTypes.RtpCapabilities,
      );
      return { type: "ack" };
    }

    case "consumer:resume": {
      await sessionManager.resumeConsumer(ctx.userId, event.consumerId);
      return { type: "ack" };
    }

    case "chat:message": {
      sessionManager.sendChatMessage(ctx.userId, event.body);
      return { type: "ack" };
    }

    case "session:leave": {
      sessionManager.leave(ctx.userId);
      return { type: "ack" };
    }

    case "permission:set": {
      sessionManager.setPermissions(ctx.userId, event.targetUserId, event.permissions);
      return { type: "ack" };
    }

    case "input:send": {
      sessionManager.sendInput(ctx.userId, event.intent);
      return { type: "ack" };
    }

    case "data:produce": {
      const result = await sessionManager.produceData(
        ctx.userId,
        event.transportId,
        event.sctpStreamParameters as MediasoupTypes.SctpStreamParameters,
        event.label,
        event.protocol,
        event.fileMeta,
      );
      return { type: "data:produced", ...result };
    }

    case "data:consume": {
      const result = await sessionManager.consumeData(ctx.userId, event.dataProducerId);
      return { type: "data:consumerCreated", ...result };
    }

    case "participant:kick": {
      sessionManager.kick(ctx.userId, event.targetUserId);
      return { type: "ack" };
    }

    case "participant:ban": {
      await sessionManager.ban(ctx.userId, event.targetUserId);
      return { type: "ack" };
    }

    case "admin:monitorSession": {
      const result = await sessionManager.monitorSession(
        ctx.userId,
        ctx.username,
        ctx.role,
        event.inviteCode,
      );
      return { type: "admin:monitorJoined", ...result };
    }
  }
}
