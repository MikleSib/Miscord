import optimizedVoiceService from '../optimizedVoiceService'

export async function playSoundboardUrl(url: string, ticket: string): Promise<void> {
  const context = new AudioContext({ sampleRate: 48_000 })
  let track: MediaStreamTrack | null = null
  let stopProducer: (() => Promise<void>) | null = null
  try {
    await context.resume()
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error('Не удалось загрузить звук.')
    const buffer = await context.decodeAudioData(await response.arrayBuffer())
    const source = context.createBufferSource()
    const destination = context.createMediaStreamDestination()
    destination.channelCount = 1
    source.buffer = buffer
    source.connect(destination)
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
