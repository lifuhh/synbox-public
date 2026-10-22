// Which tab runs the generations. Every tab of the browser shows one queue (queue.ts), but only one tab, the
// leader, holds the lock below: it opens the streams, starts waiting songs and writes the queue to
// localStorage. The other tabs show that copy and post what their buttons ask for on a BroadcastChannel.
// Every tab asks for the lock, so when the leader closes or reloads the next tab gets it and reconnects each
// running song by its request id: the backend replays the job instead of running it again.
//
// A leader can also stop without closing. A phone freezes a tab in the background, and a hidden leader waits
// to reconnect a dropped stream until it is on screen again. So a tab on screen takes the lock (steal) when
// the leader has gone quiet, or says it is hidden with a song waiting for the screen. Only then: a steal
// reopens every stream, and the server keeps the dropped ones open until they time out.

const LOCK = 'synbox:generation-leader'
const CHANNEL = 'synbox:generations'
// The leader says it is alive this often, and at once when it hides, shows or starts waiting for the screen
const PING_MS = 4000
// Silent this long, the leader is taken to be frozen. Hidden desktop tabs keep pinging, at worst once a minute
// after five minutes (Chrome's intensive throttling), which hands the lead to the tab on screen
const QUIET_MS = 15_000
// A command not answered in this long means no leader is listening
const ACK_MS = 3000
const CHECK_MS = 2000

export type Role = 'pending' | 'leader' | 'follower'

export interface TabHandlers<C> {
  // This tab runs the queue now
  lead: () => void
  // Another tab took the queue over
  follow: () => void
  // Applied by the leader, whichever tab sent it
  apply: (command: C) => void
  // A song is going: a frozen leader matters
  busy: () => boolean
  // The leader has a song waiting for this page to be on screen
  stalled: () => boolean
}

type Message<C> =
  | { type: 'alive'; hidden: boolean; stalled: boolean }
  | { type: 'command'; id: string; command: C }
  | { type: 'ack'; id: string }

// Without locks or channels (an old browser, the tests) the tab runs its own queue, as every tab once did
const supported = () =>
  typeof window !== 'undefined' &&
  typeof BroadcastChannel !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'locks' in navigator

export class Tabs<C> {
  #role: Role = 'pending'
  readonly #handlers: TabHandlers<C>
  readonly #channel: BroadcastChannel | null = null
  // Commands sent before the role was known, then those posted and not yet answered
  readonly #queued: { id: string; command: C }[] = []
  readonly #unanswered = new Map<string, C>()
  #ackTimer: ReturnType<typeof setTimeout> | undefined
  #pinger: ReturnType<typeof setInterval> | undefined
  #heardLeaderAt = Date.now()
  #leaderHidden = false
  #leaderStalled = false
  // Ends this tab's wait for the lock; a steal replaces it
  #waiting: AbortController | null = null
  // Lets go of the lock this tab holds
  #release: (() => void) | null = null

  constructor(handlers: TabHandlers<C>) {
    this.#handlers = handlers
    if (!supported()) {
      this.#role = 'leader'
      handlers.lead()
      return
    }
    this.#channel = new BroadcastChannel(CHANNEL)
    this.#channel.addEventListener(
      'message',
      (event: MessageEvent<Message<C>>) => {
        this.#receive(event.data)
      }
    )
    setInterval(() => {
      this.#check()
    }, CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      this.ping()
      this.#check()
    })
    void this.#claim()
  }

  get role() {
    return this.#role
  }

  // Applied here when this tab leads; posted to the leader otherwise
  send(command: C) {
    if (this.#role === 'leader') {
      this.#handlers.apply(command)
      return
    }
    const id = crypto.randomUUID()
    if (this.#role === 'pending') {
      this.#queued.push({ command, id })
    } else {
      this.#postCommand(id, command)
    }
  }

  // The leader tells the others how it is
  ping() {
    if (this.#role === 'leader') {
      this.#post({
        hidden: document.visibilityState === 'hidden',
        stalled: this.#handlers.stalled(),
        type: 'alive',
      })
    }
  }

  #post(message: Message<C>) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no origin
    this.#channel?.postMessage(message)
  }

  #receive(message: Message<C>) {
    if (message.type === 'command' && this.#role === 'leader') {
      this.#handlers.apply(message.command)
      this.#post({ id: message.id, type: 'ack' })
    } else if (message.type === 'ack') {
      this.#unanswered.delete(message.id)
      this.#armAck()
    } else if (message.type === 'alive') {
      this.#heardLeaderAt = Date.now()
      this.#leaderHidden = message.hidden
      this.#leaderStalled = message.stalled
      this.#check()
    }
  }

  #postCommand(id: string, command: C) {
    this.#unanswered.set(id, command)
    this.#post({ command, id, type: 'command' })
    this.#armAck()
  }

  #armAck() {
    clearTimeout(this.#ackTimer)
    if (this.#unanswered.size > 0) {
      this.#ackTimer = setTimeout(() => {
        if (this.#role === 'follower' && this.#unanswered.size > 0) {
          void this.#steal()
        }
      }, ACK_MS)
    }
  }

  // On screen, a follower takes the queue from a leader that cannot run it
  #check() {
    if (
      this.#role !== 'follower' ||
      document.visibilityState !== 'visible' ||
      !this.#handlers.busy()
    ) {
      return
    }
    if (
      Date.now() - this.#heardLeaderAt > QUIET_MS ||
      (this.#leaderHidden && this.#leaderStalled)
    ) {
      void this.#steal()
    }
  }

  #lead() {
    this.#role = 'leader'
    this.#handlers.lead()
    // What was asked of a tab that is gone, or before this one knew its role. Commands are safe to apply twice
    for (const command of this.#unanswered.values()) {
      this.#handlers.apply(command)
    }
    this.#unanswered.clear()
    for (const { command } of this.#queued.splice(0)) {
      this.#handlers.apply(command)
    }
    clearInterval(this.#pinger)
    this.#pinger = setInterval(() => {
      this.ping()
    }, PING_MS)
    this.ping()
  }

  #follow() {
    const was = this.#role
    this.#role = 'follower'
    clearInterval(this.#pinger)
    this.#heardLeaderAt = Date.now()
    if (was === 'leader') {
      this.#handlers.follow()
    }
    for (const { id, command } of this.#queued.splice(0)) {
      this.#postCommand(id, command)
    }
  }

  // Holds the lock until this tab closes or another tab steals it
  readonly #hold = async () => {
    this.#lead()
    // oxlint-disable-next-line promise/avoid-new -- held until released
    await new Promise<void>((resolve) => {
      this.#release = resolve
    })
  }

  // A request for the lock ended without this tab letting go: a held lock was stolen
  #lost() {
    if (this.#role === 'leader') {
      this.#release?.()
      this.#release = null
      this.#follow()
      void this.#wait()
    }
  }

  async #claim() {
    try {
      await navigator.locks.request(
        LOCK,
        { ifAvailable: true },
        async (lock) => {
          if (lock === null) {
            this.#follow()
            void this.#wait()
            return
          }
          await this.#hold()
        }
      )
    } catch {
      this.#lost()
    }
  }

  async #wait() {
    this.#waiting?.abort()
    const controller = new AbortController()
    this.#waiting = controller
    try {
      await navigator.locks.request(
        LOCK,
        { signal: controller.signal },
        this.#hold
      )
    } catch {
      // Our own abort ends a wait (a steal replaced it); anything else ended a held lock
      if (!controller.signal.aborted) {
        this.#lost()
      }
    }
  }

  async #steal() {
    this.#waiting?.abort()
    this.#waiting = null
    try {
      await navigator.locks.request(LOCK, { steal: true }, this.#hold)
    } catch {
      this.#lost()
    }
  }
}
