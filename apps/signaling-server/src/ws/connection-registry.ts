import type { WebSocket } from "ws";

export interface ConnectionContext {
  userId: string;
  username: string;
  role: "user" | "admin" | "master_admin";
  ws: WebSocket;
  /** RPC id of an outstanding join:requestByCode call awaiting host approve/deny. */
  pendingJoinRpcId: string | null;
}

const connections = new Map<string, ConnectionContext>();

export function registerConnection(ctx: ConnectionContext): void {
  connections.set(ctx.userId, ctx);
}

export function unregisterConnection(userId: string): void {
  connections.delete(userId);
}

export function getConnection(userId: string): ConnectionContext | undefined {
  return connections.get(userId);
}
