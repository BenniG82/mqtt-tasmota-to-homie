import { SonoffTopicListener } from './sonoff-topic-listener';
import { homieMqttConfig, sourceMqttConfig, sourceMqttConfigTasmota, tasmotaMapping, tasmotaMqttConfig } from './settings';
import { Zigbee2mqttTopicListener } from './zigbee2mqtt-topic-listener';
import { Subject, SubjectSubscriber } from 'rxjs/internal/Subject';
import { publishReplay } from 'rxjs/internal/operators';
import { SimpleConvertToHomieService } from './simple-convert-to-homie.service';
import { TasmotaConvertToHomieService } from './tasmota-convert-to-homie.service';

/**
 * Before you start this file, please take a look at the settings.ts and modify them accordingly.
 */
// SonoffTopicListener.start(tasmotaMqttConfig, homieMqttConfig, tasmotaMapping);
// Zigbee2mqttTopicListener.start(sourceMqttConfig,  new SimpleConvertToHomieService(homieMqttConfig));
Zigbee2mqttTopicListener.start(sourceMqttConfigTasmota,  new TasmotaConvertToHomieService(homieMqttConfig));
