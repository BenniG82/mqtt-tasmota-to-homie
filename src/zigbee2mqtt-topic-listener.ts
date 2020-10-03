import { OnMessageHandler, SourceMqttServerConfig } from './interfaces';
import { myLogger } from './logger';
import * as mqtt from 'mqtt';

export class Zigbee2mqttTopicListener {

    static start(sourceMqttConfig: SourceMqttServerConfig, onMessageHandler: OnMessageHandler): void {
        myLogger.info('Starting Topic Listener');
        sourceMqttConfig.baseTopics.forEach(baseTopic => {
            const client = mqtt.connect(sourceMqttConfig.brokerUrl, {
                clientId: `General Purpose Mqtt To Homie converter BT: ${baseTopic}`,
                keepalive: 60,
                password: sourceMqttConfig.password,
                username: sourceMqttConfig.username
            });
            client.on('connect', () => {
                myLogger.info('Connected');

                client.subscribe(baseTopic, (error: any) => {
                    myLogger.info('Subscription success');
                    if (error) {
                        myLogger.error(`Error: ${error}`);
                    }
                });
            });
            client.on('reconnect', () => {
                myLogger.info('Reconnected');
            });
            client.on('error', (error: any) => {
                myLogger.error(`Error ${error}`);
            });
            client.on('close', () => {
                myLogger.info('Closed');
            });
            client.on('message', (topic: string, message: string) => {
                myLogger.silly(`message received ${topic}, ${message}`);
                onMessageHandler.onMessage(baseTopic, topic, message);
            });
        });
    }
}
