import { SonoffTopicListener } from './sonoff-topic-listener';
import { homieMqttConfig, tasmotaMapping, tasmotaMqttConfig } from './settings';

/**
 * Before you start this file, please take a look at the settings.ts and modify them accordingly.
 */
SonoffTopicListener.start(tasmotaMqttConfig, homieMqttConfig, tasmotaMapping);
