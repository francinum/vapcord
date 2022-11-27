import type { Channel } from './channel'

export type RemoteSpec = Record<string, (...input: unknown[]) => Promise<any>>

/** An RPC host, can be connected to by multiple clients */
export class RemoteHost<RS extends RemoteSpec> {
  constructor(public channel: Channel, spec: RS) {
    for (const [name, fn] of Object.entries(spec)) {
      channel.onCall(name, async (input: unknown[]) => {
        const result = await fn(...input)
        return result
      })
    }

    channel.handshakeAll()
  }
}

export class RemoteClient<RS extends RemoteSpec> {
  constructor(public hostName: string, public channel: Channel) {}

  async connect() {
    await this.channel.waitForEdge(this.hostName)
  }

  run<K extends keyof RS & string>(name: K, ...output: Parameters<RS[K]>) {
    return this.channel.call({
      name,
      destination: this.hostName,
      data: output,
    }) as ReturnType<RS[K]>
  }
}
