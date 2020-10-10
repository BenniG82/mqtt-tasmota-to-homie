import { AdditionalConfiguration, MqttMessage, OnMessageHandler, SourceMqttServerConfig } from './interfaces';
import { myLogger } from '../logger';
import * as mqtt from 'mqtt';
import { fromArray } from 'rxjs/internal/observable/fromArray';
import { concatMap, delay, distinctUntilChanged } from 'rxjs/internal/operators';
import { interval, Observable, of, Subject } from 'rxjs';

export class SourceTopicListener {

    static start(sourceMqttConfig: SourceMqttServerConfig,
                 onMessageHandler: OnMessageHandler,
                 additionalConfig?: AdditionalConfiguration): void {

        myLogger.info('Starting Topic Listener');
        const client = mqtt.connect(sourceMqttConfig.brokerUrl, {
            clientId: `General Purpose Mqtt To Homie converter: ${sourceMqttConfig.baseTopics}`,
            keepalive: 60,
            password: sourceMqttConfig.password,
            username: sourceMqttConfig.username,
            resubscribe: true,
            reconnectPeriod: 2000
        });
        const msgReceived$$ = new Subject<MqttMessage>();
        msgReceived$$
            .pipe(
                distinctUntilChanged((x, y) => x.topic === y.topic && x.message === y.message)
            )
            .subscribe(msg => {
                const {topic, message} = msg;
                const baseTopic = sourceMqttConfig.baseTopics
                    .find(t => topic.startsWith(t.replace('#', '')));
                onMessageHandler.onMessage(baseTopic, topic, message);
            });

        onMessageHandler.senderClient = client;
        client.on('connect', connack => {
            myLogger.info('Connected', connack);

            client.subscribe(sourceMqttConfig.baseTopics, (error: any) => {
                myLogger.info('Source subscription success');
                if (error) {
                    myLogger.error(`Error: ${error}`);
                }
            });
            SourceTopicListener.initAdditionalConfig(additionalConfig, client);
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
            msgReceived$$.next({topic, message: message.toString()});
        });
    }

    private static initAdditionalConfig(additionalConfig: AdditionalConfiguration, client: mqtt.MqttClient): void {
        if (!additionalConfig) {
            return;
        }
        if (additionalConfig.initMessages && additionalConfig.initMessages.length > 0) {
            fromArray(additionalConfig.initMessages)
                .pipe(
                    delayEach(5000)
                )
                .subscribe(msg => {
                    myLogger.info(`Sending init message ${msg.message} to topic ${msg.topic}`);
                    client.publish(msg.topic, msg.message);
                });
        }

        if (additionalConfig.periodicalMessages && additionalConfig.periodicalMessages.length > 0) {
            const intervalMs = additionalConfig.periodicalIntervalMs ?? 5 * 60 * 1000;
            interval(intervalMs)
                .pipe(
                    concatMap(() => fromArray(additionalConfig.periodicalMessages)),
                    delayEach(5000)
                )
                .subscribe(msg => {
                    myLogger.info(`Sending periodical message ${msg.message} to topic ${msg.topic}`);
                    client.publish(msg.topic, msg.message);
                });
        }

    }
}

export const delayEach = (time: number) =>
    <T>(source: Observable<T>): Observable<T> =>
        source.pipe(
            // Delay each emission
            concatMap(msg => of(msg)
                .pipe(
                    delay(time)
                )
            )
        );
