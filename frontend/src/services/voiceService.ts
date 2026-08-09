/**
 * Screen sharing and group audio share one SFU controller.
 * The previous peer-per-participant implementation was intentionally removed.
 */
export { groupVoiceController as voiceService } from './voice/GroupVoiceController';
export { groupVoiceController as default } from './voice/GroupVoiceController';
