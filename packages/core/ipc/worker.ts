import { Channel } from './channel'
import { RemoteSpec, RemoteClient, RemoteHost } from './rpc'

export const createWorkerHost = <RS extends RemoteSpec>(
  name: string,
  spec: RS
) => {
  const channel = new Channel(name)
  channel.addPipe({
    emit: (event, data) => postMessage({ event, data }),
    listen: (event, callback) =>
      addEventListener('message', ({ data }) => {
        if (data.event === event) callback(data.data)
      }),
  })
  return new RemoteHost(channel, spec)
}

export class WorkerClient<RS extends RemoteSpec> extends RemoteClient<RS> {
  worker?: Worker
  workerListeners: EventListener[] = []
  url: string

  constructor(name: string, hostName: string, source: string | Blob) {
    const channel = new Channel(name)

    super(hostName, channel)
    if (source instanceof Blob) {
      const blob = new Blob([source], { type: 'text/javascript' })
      this.url = URL.createObjectURL(blob)
    } else this.url = source
  }

  async init() {
    const worker = (this.worker = new Worker(this.url))
    this.channel.addPipe({
      emit: (event, data) => worker.postMessage({ event, data }),
      listen: (event, callback) => {
        const listener = (ev: MessageEvent<{ event: string; data: any }>) => {
          const { event: evName, data } = ev.data
          if (evName === event) callback(data)
        }
        this.workerListeners.push(listener)
        worker.addEventListener('message', listener)
      },
    })
    await this.connect()
  }

  destroy() {
    if (this.worker) {
      for (const listener of this.workerListeners)
        this.worker.removeEventListener('message', listener)
      this.worker.terminate()
    }
    this.channel.destroy()
    if (this.url.startsWith('blob:')) URL.revokeObjectURL(this.url)
  }
}
