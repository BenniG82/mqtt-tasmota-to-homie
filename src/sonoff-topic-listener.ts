import * as mqtt from 'mqtt';
import { myLogger } from './logger';
import { ConvertToHomieService } from './convert-to-homie.service';
import { HomieDevices, MqttServerConfig, TasmotaMqttConfig } from './interfaces';

export class SonoffTopicListener {
    static client: mqtt.MqttClient;
    static deviceToConverterMap: { [topic: string]: ConvertToHomieService } = {};

    // static sonoff2mqttService: ConvertToHomieService;

    static start(tasmotaMqttConfig: TasmotaMqttConfig, homieMqttConfig: MqttServerConfig, tasmotaMapping: HomieDevices): void {
        myLogger.info('Starting Topic Listener');
        SonoffTopicListener.client = mqtt.connect(tasmotaMqttConfig.mqtt.brokerUrl, {
            clientId: 'Sonoff Topic Listener',
            keepalive: 60,
            password: tasmotaMqttConfig.mqtt.password,
            username: tasmotaMqttConfig.mqtt.username
        });
        SonoffTopicListener.client.on('connect', () => {
            myLogger.info('Connected');
            SonoffTopicListener.client.subscribe(tasmotaMqttConfig.baseTasmotaTopic, (error: any) => {
                myLogger.info('Subscription success');
                if (error) {
                    myLogger.error(`Error: ${error}`);
                }
            });

            Object.keys(tasmotaMapping)
                .forEach(deviceKey => {
                    const device = tasmotaMapping[deviceKey];
                    if (!device.$$nodes || !device.$$sourceTopic) {
                        myLogger.warn(`Error processing ${deviceKey}, needed $$nodes and $$sourceTopic not found`);

                        return;
                    }
                    myLogger.info(`Setting up device ${deviceKey} on homie ${device.$$homieTopic}`);
                    const deviceTopic = device.$$sourceTopic;
                    SonoffTopicListener.deviceToConverterMap[deviceTopic] =
                        new ConvertToHomieService(device, homieMqttConfig, SonoffTopicListener.client);
                });
        });
        SonoffTopicListener.client.on('reconnect', () => {
            myLogger.info('Reconnected');
        });
        SonoffTopicListener.client.on('error', (error: any) => {
            myLogger.error(`Error ${error}`);
        });
        SonoffTopicListener.client.on('close', () => {
            myLogger.info('Closed');
        });
        SonoffTopicListener.client.on('message', (topic: string, message: string) => {
            myLogger.debug(`message received ${topic}, ${message}`);
            Object.keys(SonoffTopicListener.deviceToConverterMap)
                .forEach(deviceTopic => {
                    if (topic.startsWith(deviceTopic)) {
                        SonoffTopicListener.deviceToConverterMap[deviceTopic].messageReceived(topic, message);
                    }
                });
        });
    }
}
