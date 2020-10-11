import { SourceTopicListener } from './lib/source-topic-listener';
import { MqttConvertToHomieService } from './lib/mqtt-convert-to-homie-service';
import { AdditionalConfiguration, SourceMqttServerConfig } from './lib/interfaces';
import { msg } from './lib/util';
import { Zigbee2mqttConvertToHomieService } from './lib/zigbee2mqtt-convert-to-homie.service';

/**
 * Here we configure the mqtt server with the source topic layout for tasmota, may be the same as the Homie mqtt server
 */
export const sourceMqttConfigTasmota: SourceMqttServerConfig = {
    brokerUrl: 'mqtt://192.168.0.45',
    username: 'mqtt',
    password: 'password',
    baseTopics: ['tele/#', 'stat/#']
};

/**
 * Here we configure the mqtt server with the source topic layout for zigbee2mqtt, may be the same as the Homie mqtt server
 */
export const sourceMqttConfig: SourceMqttServerConfig = {
    brokerUrl: 'mqtt://192.168.0.45',
    username: 'mqtt',
    password: 'password',
    baseTopics: ['zigbee2mqtt/#']
};
SourceTopicListener.start(sourceMqttConfig, new Zigbee2mqttConvertToHomieService(sourceMqttConfig), {
    initMessages: [msg('zigbee2mqtt/bridge/config/devices/get', '')]
});

const periodicalMessages = [
    msg('cmnd/tasmotas/status', '0'),
    msg('cmnd/tasmotas/POWER', ''),
    msg('cmnd/tasmotas/POWER2', '')
];
const initMessages = [
    msg('cmnd/tasmotas/status', '0'),
    msg('cmnd/tasmotas/POWER', ''),
    msg('cmnd/tasmotas/POWER2', ''),
    msg('cmnd/tasmotas/telePeriod', '30')
];

const additionalConfig: AdditionalConfiguration = {
    initMessages: initMessages,
    periodicalMessages: periodicalMessages,
    periodicalIntervalMs: 10 * 60 * 1000
};

SourceTopicListener.start(
    sourceMqttConfigTasmota,
    new MqttConvertToHomieService(sourceMqttConfigTasmota, sourceMqttConfigTasmota, ['STATUS', 'POWER', 'STATE']),
    additionalConfig);
