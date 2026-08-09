/**
 * Compatibility import for existing UI modules.
 * Group voice is implemented exclusively by the mediasoup SFU controller.
 */
export { groupVoiceController as optimizedVoiceService } from './voice/GroupVoiceController';
export { groupVoiceController as default } from './voice/GroupVoiceController';
