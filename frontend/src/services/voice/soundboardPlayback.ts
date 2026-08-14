import optimizedVoiceService from '../optimizedVoiceService'

export async function playSoundboardAudio(bytes: ArrayBuffer, ticket: string, volume = 1): Promise<void> {
  const context = new AudioContext({ sampleRate: 48_000 })
  let track: MediaStreamTrack | null = null
  let stopProducer: (() => Promise<void>) | null = null
  try {
    await context.resume()
    const buffer = await context.decodeAudioData(bytes.slice(0))
    const source = context.createBufferSource()
    const gain = context.createGain()
    const destination = context.createMediaStreamDestination()
    destination.channelCount = 1
    source.buffer = buffer
    gain.gain.value = Math.min(1, Math.max(0, volume))
    source.connect(gain).connect(destination)
    track = destination.stream.getAudioTracks()[0]
    stopProducer = await optimizedVoiceService.playSoundboard(track, ticket)
    await new Promise<void>((resolve) => {
      source.onended = () => resolve()
      source.start()
    })
  } finally {
    await stopProducer?.().catch(() => undefined)
    track?.stop()
    await context.close().catch(() => undefined)
  }
}
