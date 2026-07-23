import type { types as MediasoupTypes } from "mediasoup";
import { env } from "../env.js";

export const mediaCodecs: MediasoupTypes.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    // Forces stereo, high-bitrate Opus so screen-shared DAW/system audio
    // isn't squashed down to mono voice-chat quality by default negotiation.
    parameters: {
      "sprop-stereo": 1,
      stereo: 1,
      maxaveragebitrate: 320000,
      useinbandfec: 1,
    },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    preferredPayloadType: 96,
    clockRate: 90000,
  },
  {
    kind: "video",
    mimeType: "video/H264",
    preferredPayloadType: 102,
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
];

export const webRtcTransportOptions: MediasoupTypes.WebRtcTransportOptions = {
  listenIps: [{ ip: "0.0.0.0", announcedIp: env.MEDIASOUP_ANNOUNCED_IP }],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 2_000_000,
  // SCTP data channels — used for file transfer (samples/audio into the session).
  // maxSendMessageSize/maxReceiveMessageSize default to 262144 (256KB), which
  // is why file chunks are sent well under that (see FILE_CHUNK_SIZE client-side).
  enableSctp: true,
};

export const workerSettings: MediasoupTypes.WorkerSettings = {
  rtcMinPort: env.MEDIASOUP_MIN_PORT,
  rtcMaxPort: env.MEDIASOUP_MAX_PORT,
};
