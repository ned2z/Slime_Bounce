export type RoomMember = {
  id: string;
  name: string;
  colorIdx: number;
  balls: number;
  ready: boolean;
  isHost: boolean;
  /** CPU-controlled filler slime. */
  ai?: boolean;
  /** Added by host on this device (hot-seat), not a remote tab. */
  local?: boolean;
};

export type RoomState = {
  code: string;
  name: string;
  hostId: string;
  maxPlayers: number;
  members: RoomMember[];
  phase: "lobby" | "racing" | "results";
  seed: number;
  updatedAt: number;
};

export type BusMsg =
  | { t: "state"; room: RoomState }
  | { t: "hello"; code: string; from: string }
  | { t: "join"; code: string; member: RoomMember }
  | { t: "leave"; code: string; id: string }
  | { t: "patch"; code: string; id: string; patch: Partial<RoomMember> }
  | { t: "kick"; code: string; id: string }
  | { t: "settings"; code: string; name?: string; maxPlayers?: number }
  | { t: "start"; code: string; seed: number; members: RoomMember[] }
  | { t: "ended"; code: string };
