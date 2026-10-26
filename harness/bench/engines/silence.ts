// Every browser the harness drives is silent (AGENTS.md: the owner works beside these runs). Chromium has
// --mute-audio, WebKit has no such flag, so this init script runs in every frame of every context, the YouTube
// embed included (Playwright applies context init scripts to child and cross-origin frames): media elements are
// held muted at volume 0 whatever the page sets, and Web Audio reaches the speakers only through a zero gain

/* oxlint-disable unicorn/consistent-function-scoping, typescript/unbound-method -- silenceAllMedia() is serialised with toString() and injected into every frame, so its helpers live inside it, and it re-applies the browser's own media accessors with an explicit `this` */

export const silenceAllMedia = (): void => {
  const media = HTMLMediaElement.prototype
  const muted = Object.getOwnPropertyDescriptor(media, 'muted')
  const volume = Object.getOwnPropertyDescriptor(media, 'volume')
  const hush = (element: HTMLMediaElement) => {
    muted?.set?.call(element, true)
    volume?.set?.call(element, 0)
  }
  const pin = (
    name: 'muted' | 'volume',
    own: PropertyDescriptor | undefined,
    value: boolean | number
  ) => {
    const get = own?.get
    const set = own?.set
    if (get && set) {
      Object.defineProperty(media, name, {
        configurable: true,
        get(this: HTMLMediaElement): unknown {
          const current: unknown = get.call(this)
          return current
        },
        set(this: HTMLMediaElement) {
          set.call(this, value)
        },
      })
    }
  }
  pin('muted', muted, true)
  pin('volume', volume, 0)
  const originalPlay = media.play
  media.play = async function play(this: HTMLMediaElement) {
    hush(this)
    await originalPlay.call(this)
  }
  for (const type of ['loadstart', 'play', 'playing', 'volumechange']) {
    document.addEventListener(
      type,
      (event) => {
        if (event.target instanceof HTMLMediaElement) {
          hush(event.target)
        }
      },
      true
    )
  }
  const originalConnect = AudioNode.prototype.connect
  const connect = function connect(
    this: AudioNode,
    ...args: unknown[]
  ): unknown {
    if (args[0] instanceof AudioDestinationNode) {
      const zero = this.context.createGain()
      zero.gain.value = 0
      Reflect.apply(originalConnect, this, [zero])
      const silenced: unknown = Reflect.apply(originalConnect, zero, args)
      return silenced
    }
    const result: unknown = Reflect.apply(originalConnect, this, args)
    return result
  }
  Object.defineProperty(AudioNode.prototype, 'connect', {
    configurable: true,
    value: connect,
    writable: true,
  })
}
