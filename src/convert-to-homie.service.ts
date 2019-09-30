import * as mqtt from 'mqtt';
import * as _ from 'lodash';
import { Subject, timer } from 'rxjs';
import { take } from 'rxjs/internal/operators';
import { myLogger } from './logger';
import { environment } from './settings';
import { HomieDevice, HomieNode, HomieProperty } from './interfaces';

interface MessageInTopic {
    topic: string;
    message: string;
}

const logger = myLogger;
const publishOptions: mqtt.IClientPublishOptions = {retain: true, qos: 1};

export class ConvertToHomieService {
    private readonly deviceTopic: string;
    private commandMap: { [topic: string]: HomieProperty } = {};
    private client: mqtt.MqttClient;
    private connect$$: Subject<void> = new Subject<void>();
    private messages$$: Subject<MessageInTopic> = new Subject<MessageInTopic>();

    private static convertToMessageObject(messageInTopic: any, topic: string): any {
        const message = messageInTopic.message;
        const topicParts = topic.split('/');
        const lastTopicPart = topicParts[topicParts.length - 1];
        const messageObj: any = {};
        const messageAsString = message.toString();
        messageObj[lastTopicPart] = messageAsString.startsWith('{') && messageAsString.endsWith('}')
            ? JSON.parse(messageAsString)
            : messageAsString;

        return messageObj;
    }

    constructor(private readonly homieDevice: HomieDevice) {
        this.deviceTopic = homieDevice.$$homieTopic;
        this.connect(homieDevice);

        // Wait for connection before starting to send messages
        this.connect$$.asObservable()
            .pipe(take(1))
            .subscribe(() => {
                this.initHomie();
                this.initMessageHandling();
                this.initHomieMessages();
            });
    }

    messageReceived(topic: string, message: any): void {
        this.messages$$.next({topic, message});
    }

    private initHomie(): void {
        const device = this.homieDevice;

        this.publish(`${this.deviceTopic}/$state`, 'init');
        Object.keys(device)
            .forEach(itemKey => {
                if (itemKey.startsWith('$$')) {
                    if (itemKey === '$$nodes') {
                        this.initNodes(device[itemKey]);
                    }
                } else {
                    const value = (device as any)[itemKey];
                    this.publish(`${this.deviceTopic}/${itemKey}`, value);
                }
            });
        timer(5000)
            .pipe(take(1))
            .subscribe(() => {
                this.publish(`${this.deviceTopic}/$state`, 'ready');
            });
    }

    private connect(device: HomieDevice): void {
        this.client = mqtt.connect(environment.mqtt.brokerUrl, {
            clientId: `Sonoff Topic Publisher ${device.$$sourceTopic}`,
            password: environment.mqtt.password,
            username: environment.mqtt.username,
            will: {topic: `${this.deviceTopic}/$state`, payload: 'lost', qos: 1, retain: true}
        });
        this.client.on('connect', () => {
            this.connect$$.next();
            this.subscribeToCommands();
        });
    }

    private publish(topic: string, value: string): void {
        logger.debug(`Publishing to topic ${topic} => ${value}`);
        const valueAsString = value.toString();
        this.client.publish(topic, valueAsString, publishOptions, ((error: any) => {
            if (error) {
                logger.error(`An error has occurred while sending a message ${error}`);
            }
        }));
    }

    private initNodes(nodes: any): void {
        const nodeKeys = Object.keys(nodes)
            .join(',');
        this.publish(`${this.deviceTopic}/$nodes`, nodeKeys);
        Object.keys(nodes)
            .forEach(nodeKey => {
                const node: any = nodes[nodeKey];
                const properties = Object.keys(node)
                    .join(',');
                this.publish(`${this.deviceTopic}/${nodeKey}/$name`, nodeKey);
                this.publish(`${this.deviceTopic}/${nodeKey}/$properties`, properties);

                Object.keys(node)
                    .forEach(propertyKey => {
                        const property = node[propertyKey];
                        Object.keys(property)
                            .forEach(propertyAttributeKey => {
                                if (!propertyAttributeKey.startsWith('$$')) {
                                    const propertyAttributeValue = property[propertyAttributeKey];
                                    this.publish(`${this.deviceTopic}/${nodeKey}/${propertyKey}/${propertyAttributeKey}`,
                                        propertyAttributeValue);
                                }
                            });

                    });
            });

    }

    private initMessageHandling(): void {
        this.messages$$.asObservable()
            .subscribe((messageInTopic: MessageInTopic) => {
                const topic = messageInTopic.topic;
                myLogger.debug(`Processing message ${messageInTopic.message} in topic ${topic}`);
                const messageObj = ConvertToHomieService.convertToMessageObject(messageInTopic, topic);

                const device = this.homieDevice;

                Object.keys(device.$$nodes)
                    .forEach(nodeKey => {
                        const node = device.$$nodes[nodeKey];
                        Object.keys(node)
                            .forEach(attributeKey => {
                                const attribute = node[attributeKey];
                                if (attribute.$$value && attribute.$$value.startsWith('%') && attribute.$$value.endsWith('%')) {
                                    const valueToLookup = attribute.$$value.substring(1, attribute.$$value.length - 1);
                                    const value = _.get(messageObj, valueToLookup);
                                    myLogger.debug(`Value to lookup ${valueToLookup} resolved to ${value} at ${attributeKey}`);
                                    if (value) {
                                        const targetTopic = `${this.deviceTopic}/${nodeKey}/${attributeKey}`;
                                        // attribute.$$lastKnown = value;
                                        this.publish(targetTopic, value);
                                    }
                                }
                            });
                    });
            });
    }

    private subscribeToCommands(): void {
        Object.keys(this.homieDevice.$$nodes)
            .forEach(nodeKey => {
                // Node is e.g. SP111 level
                const node: HomieNode = this.homieDevice.$$nodes[nodeKey];
                Object.keys(node)
                    .forEach(propertyKey => {
                        const property = node[propertyKey];
                        if (property.$$command) {
                            const topic = `${this.deviceTopic}/${nodeKey}/${propertyKey}/set`;
                            this.commandMap[topic] = property;
                            this.client.subscribe(topic, (err: Error) => {
                                myLogger.debug(`Subscription for ${topic}: ${err}`);
                            });
                        }
                    });

            });
    }

    private initHomieMessages(): void {
        this.client.on('message', (topic, message) => {
            Object.keys(this.commandMap)
                .forEach(commandMapTopic => {
                    if (commandMapTopic === topic && message && message.length > 0) {
                        const property = this.commandMap[topic];
                        myLogger.info(`Sending command from ${topic} to tasmota ${property.$$command}: ${message}`);
                        this.client.publish(property.$$command, message);
                        this.client.publish(topic, '');
                    }
                });
        });
    }
}
