import * as mqtt from 'mqtt';
import { environment, SONOFF_MAPPING } from './settings';
import { myLogger } from './logger';
import { ConvertToHomieService } from './convert-to-homie.service';


export class SonoffTopicListener {
    static client: mqtt.MqttClient;
    static deviceToConverterMap: { [topic: string]: ConvertToHomieService } = {};

    // static sonoff2mqttService: ConvertToHomieService;

    static start(): void {
        myLogger.info('Starting Topic Listener');
        SonoffTopicListener.client = mqtt.connect(environment.mqtt.brokerUrl, {
            clientId: 'Sonoff Topic Listener',
            keepalive: 60,
            password: environment.mqtt.password,
            username: environment.mqtt.username
        });
        SonoffTopicListener.client.on('connect', () => {
            myLogger.info('Connected');
            SonoffTopicListener.client.subscribe(environment.baseTasmotaTopic, (error: any) => {
                myLogger.info('Subscription success');
                if (error) {
                    myLogger.error(`Error: ${error}`);
                }
            });

            Object.keys(SONOFF_MAPPING)
                .forEach(deviceKey => {
                    const device = SONOFF_MAPPING[deviceKey];
                    if (!device.$$nodes || !device.$$sourceTopic) {
                        myLogger.warn(`Error processing ${deviceKey}, needed $$nodes and $$sourceTopic not found`);

                        return;
                    }
                    myLogger.info(`Setting up device ${deviceKey} on homie ${device.$$homieTopic}`);
                    const deviceTopic = device.$$sourceTopic;
                    SonoffTopicListener.deviceToConverterMap[deviceTopic] = new ConvertToHomieService(device);
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

SonoffTopicListener.start();
