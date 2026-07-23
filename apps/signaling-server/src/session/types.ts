import type { types as MediasoupTypes } from "mediasoup";
import type { FileMeta, InputIntent, MediaTag, Permissions } from "@daw-cast/shared-types";

export interface PublicUserRef {
  id: string;
  username: string;
}

export const NO_PERMISSIONS: Permissions = { mouse: false, keyboard: false, fileTransfer: false };

export interface ParticipantState {
  userId: string;
  username: string;
  permissions: Permissions;
  rtpCapabilities?: MediasoupTypes.RtpCapabilities;
  sendTransport?: MediasoupTypes.WebRtcTransport;
  recvTransport?: MediasoupTypes.WebRtcTransport;
  producers: Map<string, MediasoupTypes.Producer>;
  consumers: Map<string, MediasoupTypes.Consumer>;
  dataProducers: Map<string, MediasoupTypes.DataProducer>;
  dataConsumers: Map<string, MediasoupTypes.DataConsumer>;
}

export interface SessionState {
  id: string;
  hostUserId: string;
  inviteCode: string;
  router: MediasoupTypes.Router;
  participants: Map<string, ParticipantState>;
  /** Invisible admin observers — never surfaced to participants, never allowed to produce. */
  monitors: Map<string, ParticipantState>;
  maxParticipants: number;
  createdAt: Date;
}

export interface PendingJoinRequest {
  requestId: string;
  sessionId: string;
  userId: string;
  username: string;
}

export interface ProducerRef {
  producerId: string;
  kind: "audio" | "video";
  ownerUserId: string;
  mediaTag: MediaTag;
}

export type SessionManagerEvents = {
  incomingJoinRequest: [
    payload: { hostUserId: string; requestId: string; fromUser: PublicUserRef },
  ];
  joinResolved: [
    payload:
      | {
          userId: string;
          approved: true;
          sessionId: string;
          rtpCapabilities: MediasoupTypes.RtpCapabilities;
          existingProducers: ProducerRef[];
          existingParticipants: PublicUserRef[];
        }
      | { userId: string; approved: false; reason: string },
  ];
  participantJoined: [payload: { toUserIds: string[]; user: PublicUserRef }];
  participantLeft: [payload: { toUserIds: string[]; userId: string }];
  producerNew: [payload: { toUserIds: string[] } & ProducerRef];
  chatMessage: [
    payload: { toUserIds: string[]; from: PublicUserRef; body: string; sentAt: string },
  ];
  sessionClosed: [payload: { toUserIds: string[]; reason: string }];
  permissionUpdated: [payload: { toUserIds: string[]; userId: string; permissions: Permissions }];
  inputReceived: [payload: { hostUserId: string; fromUserId: string; intent: InputIntent }];
  dataProducerNew: [
    payload: { hostUserId: string; dataProducerId: string; fromUserId: string; fileMeta: FileMeta },
  ];
  removedFromSession: [
    payload: { targetUserId: string; toOthers: string[]; reason: string; permanent: boolean },
  ];
};
