import { Room } from './room.js';

export interface RoomLease {
  readonly room: Room;
  release(): void;
}

export class RoomRegistry {
  private readonly rooms = new Map<number, Room>();
  private readonly pendingRooms = new Map<number, Promise<Room>>();
  private readonly reservations = new Map<number, number>();
  private closed = false;

  async acquire(channelId: number, epoch: string): Promise<RoomLease> {
    if (this.closed) throw new Error('Room registry is closed');
    this.reservations.set(channelId, (this.reservations.get(channelId) ?? 0) + 1);
    try {
      const room = await this.getOrCreate(channelId, epoch);
      let released = false;
      return {
        room,
        release: () => {
          if (released) return;
          released = true;
          this.releaseReservation(channelId);
        },
      };
    } catch (error) {
      this.releaseReservation(channelId);
      throw error;
    }
  }

  get(channelId: number): Room | undefined {
    return this.rooms.get(channelId);
  }

  size(): number {
    return this.rooms.size;
  }

  async moderateSession(
    sessionId: string,
    command: { server_muted?: boolean; server_deafened?: boolean; disconnect?: boolean },
  ): Promise<boolean> {
    for (const room of this.rooms.values()) {
      if (await room.moderatePeer(sessionId, command)) return true;
    }
    return false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    this.pendingRooms.clear();
    this.reservations.clear();
  }

  private async getOrCreate(channelId: number, epoch: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) {
      if (existing.epoch !== epoch) throw new Error('Room epoch mismatch');
      return existing;
    }
    const pending = this.pendingRooms.get(channelId);
    if (pending) {
      const room = await pending;
      if (room.epoch !== epoch) throw new Error('Room epoch mismatch');
      return room;
    }

    const creation = Room.create(channelId, epoch);
    this.pendingRooms.set(channelId, creation);
    try {
      const room = await creation;
      if (this.closed) {
        room.close();
        throw new Error('Room registry is closed');
      }
      room.onEmpty(() => this.discardIfUnused(channelId, room));
      this.rooms.set(channelId, room);
      return room;
    } finally {
      if (this.pendingRooms.get(channelId) === creation) this.pendingRooms.delete(channelId);
    }
  }

  private releaseReservation(channelId: number): void {
    const remaining = (this.reservations.get(channelId) ?? 1) - 1;
    if (remaining > 0) {
      this.reservations.set(channelId, remaining);
      return;
    }
    this.reservations.delete(channelId);
    const room = this.rooms.get(channelId);
    if (room) this.discardIfUnused(channelId, room);
  }

  private discardIfUnused(channelId: number, room: Room): void {
    if ((this.reservations.get(channelId) ?? 0) > 0) return;
    if (this.rooms.get(channelId) !== room || !room.isEmpty()) return;
    this.rooms.delete(channelId);
    room.close();
  }
}

export const rooms = new RoomRegistry();
