export class OutgoingMessageOwnership {
  private readonly localNonces = new Set<string>()
  private leader = true

  claim(clientNonce: string): void {
    this.localNonces.add(clientNonce)
  }

  release(clientNonce: string): void {
    this.localNonces.delete(clientNonce)
  }

  clear(): void {
    this.localNonces.clear()
    this.leader = false
  }

  setLeader(value: boolean): void {
    this.leader = value
  }

  isLeader(): boolean {
    return this.leader
  }

  canProcess(clientNonce: string): boolean {
    return this.leader || this.localNonces.has(clientNonce)
  }
}
