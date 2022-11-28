import { EventEmitter } from 'eventemitter3'

const ipcPrefix = 'vapIpc'
const kEdgeCreate = Symbol.for('vapIpc.edgeCreate')

type Logger = {
  log: (...args: any[]) => void
}

/**
 * An edge is a channel's understanding of another channel.
 *
 * `id` is the other channel,
 * `channelIds` is the set of channels that the other channel knows about
 */
export type ChannelEdge = {
  id: string
  channelIds: string[]
}
export type ChannelMessageIn = {
  name: string
  destination: string // Edge Id
  data: any
}
export type ChannelMessageOut = ChannelMessageIn & {
  source: string // Edge Id
  proxiedBy?: string // Edge Id
  nonce?: string
}
/** A pipe is the communication layer between a channel and an edge. */
export type ChannelPipe = {
  emit: (event: string, data: any) => void
  listen: (event: string, callback: (data: any) => void) => void
}

/** A port essentially a broadcast network for pipes,
 * meaning that emissions from one pipe are sent to all other pipes.
 */
export class ChannelPort {
  _pipes: Map<string, ChannelPipe> = new Map()
  _listeners: Map<string, ReturnType<ChannelPort['_createListenerMap']>> =
    new Map()

  _createListenerMap(): Map<string, (...data: any[]) => void> {
    return new Map()
  }
  _emit(sourceName: string, event: string, ...data: any[]) {
    for (const [pipeName, listenerMap] of this._listeners.entries()) {
      if (pipeName === sourceName) continue

      const listener = listenerMap.get(event)
      if (listener) listener(...data)
    }
  }

  createPipe(name: string): ChannelPipe {
    const existingPipe = this.getPipe(name)
    if (existingPipe) return existingPipe

    const listenerMap = this._createListenerMap()
    this._listeners.set(name, listenerMap)

    const pipe: ChannelPipe = {
      emit: this._emit.bind(this, name),
      listen: (event, fn) => void listenerMap.set(event, fn),
    }

    this._pipes.set(name, pipe)
    return pipe
  }
  getPipe(name: string): ChannelPipe | null {
    return this._pipes.get(name) ?? null
  }
}

/** A channel is a node in a decentralized ipc network.
 * Each channel can talk to other channels through pipes,
 * and channels identify each other through handshakes.
 * The handshake will also let other channels know which channels
 * they can redirect messages to.
 * This implementation does **NOT** account for [ring topologies](https://en.wikipedia.org/wiki/Ring_network).
 **/
export class Channel {
  // TODO: better debug logs
  /** edge id -> edge */
  _edges: Map<string, ChannelEdge> = new Map()
  /** nonce -> callback */
  _callbacks: Map<string, (...data: any[]) => void> = new Map()
  /** message name -> caller */
  _callers: Map<string, (...data: any[]) => Promise<any>> = new Map()
  /** edge id -> pipe */
  _edgePipes: Map<string, ChannelPipe> = new Map()

  _pipes: ChannelPipe[] = []
  _emitter = new EventEmitter()
  _logger?: Logger
  _destroyed = false

  constructor(public id: string) {}

  addPipe(pipe: ChannelPipe) {
    pipe.listen(`${ipcPrefix}:handshake`, (edge: ChannelEdge) => {
      this._handleHandshake(pipe, edge)
    })
    pipe.listen(`${ipcPrefix}:message`, (message: ChannelMessageOut) => {
      this._handleMessage(pipe, message)
    })
    this._pipes.push(pipe)
    this._logger?.log(`Adding pipe to channel "${this.id}"`)
  }
  setLogger(logger: Logger) {
    this._logger = logger
  }

  _handleHandshake(pipe: ChannelPipe, edge: ChannelEdge) {
    if (this.id === edge.id) return
    // TODO: improve the way channels store edges

    this._logger?.log(
      `🤝 "${edge.id}" -> "${this.id}" (edges: [${edge.channelIds.join(', ')}])`
    )

    const prevEdge = this._edges.get(edge.id)
    if (prevEdge) {
      const newEdgeIds = edge.channelIds.filter(
        (edgeId) => !prevEdge?.channelIds.includes(edgeId)
      )

      if (newEdgeIds.includes(this.id)) {
        newEdgeIds.splice(newEdgeIds.indexOf(this.id), 1)
      }
      if (!newEdgeIds.length) return

      this._edges.set(edge.id, {
        ...edge,
        channelIds: [...prevEdge.channelIds, ...newEdgeIds],
      })
    } else {
      const edgeIds = [...edge.channelIds].filter(
        (edgeId) => edgeId !== this.id
      )
      this._edges.set(edge.id, {
        ...edge,
        channelIds: edgeIds,
      })
      this._edgePipes.set(edge.id, pipe)
    }
    this._emitter.emit(kEdgeCreate, edge)
    this.handshakeAll()
  }
  _handleMessage(pipe: ChannelPipe, message: ChannelMessageOut) {
    if (message.proxiedBy === this.id) return
    if (message.destination !== this.id) {
      return this._emitMessage({
        ...message,
        proxiedBy: this.id,
      })
    }

    // Event
    if (!message.nonce)
      return void this._emitter.emit(message.name, message.data)

    // Response
    const callback = this._callbacks.get(message.nonce)
    if (callback) return void callback(message.data)

    // Call
    const caller = this._callers.get(message.name)
    if (caller) {
      caller(message.data)
        .catch((error) => {
          console.error(error)
          return new Error(error?.message ?? `${error}`)
        })
        .then((data) => {
          this._emitMessage({
            name: message.name,
            source: this.id,
            destination: message.source,
            data,
            nonce: message.nonce,
          })
        })
      return
    }
  }

  _emitHandshake(pipe: ChannelPipe) {
    const edge = this.getEdge()
    pipe.emit(`${ipcPrefix}:handshake`, edge)
  }
  _emitMessage(message: ChannelMessageOut) {
    const edgeId = this.findEdgeId(message.destination)
    if (!edgeId) return // TODO: bucket edge emissions until handshake?
    const pipe = this._edgePipes.get(edgeId)
    pipe?.emit(`${ipcPrefix}:message`, message)
  }

  getEdge(): ChannelEdge {
    const edgeIds = [
      ...this._edges.keys(),
      ...[...this._edges.values()].map((edge) => edge.channelIds).flat(),
    ].filter((id, index, arr) => arr.indexOf(id) === index)
    return {
      id: this.id,
      channelIds: edgeIds,
    }
  }
  findEdgeId(destinaton: string): string | null {
    for (const edge of this._edges.values()) {
      if (edge.id === destinaton || edge.channelIds.includes(destinaton)) {
        return edge.id
      }
    }
    return null
  }
  waitForEdge(destination: string): Promise<string> {
    const edgeId = this.findEdgeId(destination)
    if (edgeId) return Promise.resolve(edgeId)

    return new Promise((resolve) => {
      const checkEdge = (edge: ChannelEdge) => {
        if (edge.id === destination || edge.channelIds.includes(destination)) {
          this._emitter.off(kEdgeCreate, checkEdge)
          resolve(edge.id)
        }
      }
      this._emitter.on(kEdgeCreate, checkEdge)
    })
  }

  createNonce() {
    return Math.random().toString(16).slice(2)
  }

  send(messageData: ChannelMessageIn) {
    this._emitMessage({
      ...messageData,
      source: this.id,
    })
  }
  call(
    messageData: ChannelMessageIn,
    opts: { timeout: number } = { timeout: 10000 }
  ): Promise<any> {
    const nonce = this.createNonce()

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._callbacks.delete(nonce)
        reject(new Error('Call timed out'))
      }, opts.timeout)
      this._callbacks.set(nonce, (data) => {
        this._callbacks.delete(nonce)
        clearTimeout(timeout)
        if (data instanceof Error) reject(data)
        else resolve(data)
      })
    })

    this._emitMessage({
      ...messageData,
      source: this.id,
      nonce,
    })

    return promise
  }
  on(name: string, fn: (...data: any) => void) {
    this._emitter.on(name, fn)
    return this
  }
  off(name: string, fn?: (...data: any) => void) {
    this._emitter.off(name, fn)
    return this
  }
  once(name: string, fn: (...data: any) => void) {
    this._emitter.once(name, fn)
    return
  }
  onCall(name: string, caller: (...data: any) => any) {
    this._callers.set(name, async (...data: any[]) => await caller(...data))
  }
  removeCaller() {}
  handshakeAll() {
    this._pipes.forEach((pipe) => this._emitHandshake(pipe))
  }

  destroy() {
    this._emitter.removeAllListeners()
    this._callbacks.clear()
    this._callers.clear()
    this._edgePipes.clear()
    this._pipes = []
    this._destroyed = true
  }
}
