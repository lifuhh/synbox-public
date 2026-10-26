// Every browser the harness drives is silent (AGENTS.md: the owner works beside these runs). Chromium has
// --mute-audio, WebKit has no such flag, so this init script runs in every frame of every context, the YouTube
// embed included (Playwright applies context init scripts to child and cross-origin frames): media elements are
// held muted at volume 0 whatever the page sets, and Web Audio reaches the speakers only through a zero gain
export const silenceAllMedia = (): void => {
  const media = HTMLMediaElement.prototype
  const muted = Object.getOwnPropertyDescriptor(media, 'muted')
  const volume = Object.getOwnPropertyDescriptor(media, 'volume')
  const hush = (element: HTMLMediaElement) => {
    muted?.set?.call(element, true)
    volume?.set?.call(element, 0)
  }
  if (muted?.get !== undefined && muted.set !== undefined) {
    Object.defineProperty(media, 'muted', {
      configurable: true,
      get: muted.get,
      set(this: HTMLMediaElement) {
        muted.set?.call(this, true)
      },
    })
  }
  if (volume?.get !== undefined && volume.set !== undefined) {
    Object.defineProperty(media, 'volume', {
      configurable: true,
      get: volume.get,
      set(this: HTMLMediaElement) {
        volume.set?.call(this, 0)
      },
    })
  }
  const play = media.play
  media.play = function playSilently(this: HTMLMediaElement) {
    hush(this)
    return play.call(this)
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
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function connectSilently(
    this: AudioNode,
    ...args: unknown[]
  ) {
    const [target] = args
    if (target instanceof AudioDestinationNode) {
      const zero = this.context.createGain()
      zero.gain.value = 0
      Reflect.apply(connect, this, [zero])
      return Reflect.apply(connect, zero, args) as AudioNode
    }
    return Reflect.apply(connect, this, args) as AudioNode
  } as typeof AudioNode.prototype.connect
}
